// server.js — lobby + authoritative server. Run with Node (not Bun): the
// from-scratch WebSocket server needs Node's `http` upgrade handshake.
//
// One `WebSocketServer` accepts every connection into the lobby first (room
// codes, Team + Character select, ready-up — see room.js). Per ADR-0001 that
// routing lives here, not in @cjgammon/gamekit-server: each Room gets its own
// `ServerGame`/`NetServer`, created only once all of that Room's players are
// ready, so multiple Matches can run concurrently in this one process.
import { ServerGame, WebSocketServer, ServerTransport } from "@cjgammon/gamekit-server";
import { Entity, Tilemap } from "@cjgammon/gamekit";
import {
  TICK_RATE, PORT, TILE, TEAMS,
  CHAR_W, CHAR_H, CHAR_HP, DRAG_X, MAX_VEL_X, MAX_VEL_Y, SPAWN_Y, TEAM_COLORS, CHARACTERS,
  stepCharacter,
} from "./shared.js";
import { stepPrimaryAbility } from "./abilities.js";
import { getMap, buildMapData, worldSize } from "./maps.js";
import { LobbyManager } from "./room.js";
import { Minion, canEngage, resolveMinionCombat, laneWaypoints, MINION_SPAWN_INTERVAL } from "./minions.js";
import { Tower, Base, canEngageTower, canEngageBase, resolveStructureDamage } from "./structures.js";
import {
  Projectile, PROJECTILE_W, PROJECTILE_H, PROJECTILE_COOLDOWN,
  canHit, applyProjectileDamage,
} from "./projectiles.js";
import {
  MELEE_COOLDOWN,
  meleeHitbox, canHitMelee, applyMeleeDamage,
} from "./melee.js";

// One entry per shared.js's CHARACTERS id: each kit's Primary Ability
// cooldown and its fire effect. The two kits' Primary Abilities otherwise
// share everything — the generic stepPrimaryAbility cooldown/edge-trigger
// step above, and (via stepCharacter) the same dash Secondary Ability — so
// this table is the one place kit-specific behavior lives, rather than
// Character branching on `this.character` itself (see #8's acceptance
// criteria on not duplicating ranged-Character-specific logic).
const KITS = {
  [CHARACTERS[0].id]: {
    cooldown: PROJECTILE_COOLDOWN,
    // Spawns a Projectile just past the Character's leading edge, traveling
    // toward `facing`. Delegates to the combat director (rather than
    // net.spawn'ing directly) so the Projectile is tracked for hit
    // resolution the same way Minions are tracked — see
    // MinionDirector.spawnProjectile.
    fire(character) {
      const x = character.facing > 0
        ? character.x + character.width
        : character.x - PROJECTILE_W;
      const y = character.y + character.height / 2 - PROJECTILE_H / 2;
      character.game.combatDirector.spawnProjectile(x, y, character.team, character.facing);
    },
  },
  [CHARACTERS[1].id]: {
    cooldown: MELEE_COOLDOWN,
    // Resolves instantly against a hitbox in front of the Character — see
    // MinionDirector.resolveMeleeSwing.
    fire(character) {
      character.game.combatDirector.resolveMeleeSwing(character);
    },
  },
};

// Selects which Map to run — the client must be pointed at the same one
// (its `?map=` query param) since both sides build the Tilemap locally.
const map = getMap(process.env.MAP_ID || "singleLane");
const { width: WORLD_W, height: WORLD_H } = worldSize(map);

const tilemap = new Tilemap(map.cols, map.rows, TILE, TILE, buildMapData(map));

class Character extends Entity {
  // The server sets this from the client's latest input each tick.
  input = { left: false, right: false, jump: false, fire: false, dash: false };
  // Last non-neutral horizontal input direction — where the Primary Ability
  // fires (see projectiles.js's stepPrimaryAbility) and which way the dash
  // Secondary Ability launches (see shared.js's stepCharacter). Defaults to
  // facing right.
  facing = 1;
  primaryCooldown = 0;
  // Secondary Ability (dash) state — advanced by shared.js's stepCharacter,
  // the same predicted function the client replays, so it must round-trip
  // through netState()/applyNetState() below like grounded/prevJump does.
  dashCooldown = 0;
  dashTimer = 0;
  // Server-authoritative only (see shared.js's CHAR_HP) — not predicted or
  // netState'd, same as Minion/Tower/Base hp.
  hp = CHAR_HP;

  constructor(x, y, team, character, game) {
    super(x, y);
    this.width = CHAR_W;
    this.height = CHAR_H;
    this.drag.set(DRAG_X, 0);
    this.maxVelocity.set(MAX_VEL_X, MAX_VEL_Y);
    this.color = TEAM_COLORS[team];
    this.character = character;
    this.kit = KITS[character] ?? KITS[CHARACTERS[0].id];
    this.team = team;
    this.game = game;
  }

  // The authoritative simulation: gravity, run, jump, tilemap collision, then
  // the Primary Ability's cooldown/facing/fire-edge state (see #6) and its
  // kit-specific effect (see the KITS table above).
  fixedUpdate(dt) {
    stepCharacter(this, this.input, dt, tilemap);
    if (stepPrimaryAbility(this, this.input, dt, this.kit.cooldown)) this.kit.fire(this);
  }

  // Per-entity payload the client reads via CharacterView.applyNetState.
  // Besides color, this carries grounded/prevJump: gamekit 0.2.0 restores
  // velocity automatically before reconciliation replay (SnapshotEntity now
  // carries vx/vy), but grounded/prevJump are app-specific jump-edge state
  // the engine doesn't know about — stale values here let a replayed tick
  // re-fire or drop a jump. applyNetState is guaranteed to run before the
  // replay (see SimulateFn's doc comment in gamekit).
  netState() {
    return {
      color: this.color,
      character: this.character,
      grounded: this._grounded,
      prevJump: this._prevJump,
      facing: this.facing,
      prevDash: this._prevDash,
      dashCooldown: this.dashCooldown,
      dashTimer: this.dashTimer,
    };
  }
}

// Drives Minion waves, same-Lane combat, and Character Primary Ability
// Projectiles for a Match, independent of any connection — see acceptance
// criteria on #4 ("no player input required"). Not net.spawn'd itself (no
// visual representation to sync); startMatch below adds one to each Match's
// Scene ahead of any Minion, so its fixedUpdate (combat resolution, then
// spawning) always runs before theirs within the same tick, letting a
// Minion's own fixedUpdate see this tick's `engaged` flag the moment it's
// set.
class MinionDirector extends Entity {
  constructor(game) {
    super();
    this.game = game;
    // One spawn countdown per Lane per Team, seeded at 0 so the first wave on
    // each Lane appears immediately rather than after a full wait.
    this.timers = map.lanes.map(() => Object.fromEntries(TEAMS.map((t) => [t, 0])));
    // Tracked directly (rather than queried from the scene) so structure
    // gating can walk "this Minion's own Lane's Tower" in O(1) — see
    // _resolveStructureDamage.
    this.minions = [];
    // Live Projectiles fired by any Character's Primary Ability (see
    // Character._firePrimary/spawnProjectile below) — tracked here for
    // lifetime/despawn bookkeeping (_despawnProjectiles); each Projectile
    // resolves its own hit test against `minions`/`towers` (see
    // resolveProjectileHit below).
    this.projectiles = [];
    // Set once a Base's core is destroyed — freezes further combat/spawning
    // (see fixedUpdate) so the Match stops in place instead of continuing
    // past the losing Team's Base falling.
    this.winner = null;

    this.towers = map.lanes.map((lane, laneIndex) => {
      const t = lane.tower;
      const tower = new Tower(t.x, t.y, t.w, t.h, laneIndex);
      tower.netId = this.game.net.spawn("tower", tower);
      return tower;
    });

    this.bases = map.bases.map((b) => {
      const base = new Base(b.x, b.y, b.w, b.h, b.team);
      base.netId = this.game.net.spawn("base", base);
      return base;
    });
  }

  fixedUpdate(dt) {
    if (this.winner !== null) return; // Match over.
    this._resolveCombat();
    this._spawnWaves(dt);
    // Projectiles resolve their own hits (see resolveProjectileHit below and
    // projectiles.js's comment on why) as part of their own fixedUpdate later
    // in this same tick's scene sweep — this only sweeps up whatever's spent
    // or expired as of last tick.
    this._despawnProjectiles();
  }

  _resolveCombat() {
    this._resolveMinionCombat();
    this._resolveStructureDamage();
  }

  // Same-Lane, opposing-Team Minion pairs only — a converging multi-Lane Map
  // (see maps.js's twinLanes) can put different Lanes' Minions in physical
  // overlap, so laneIndex is checked (via canEngage) in addition to the AABB
  // test itself.
  _resolveMinionCombat() {
    this.game.scene.overlap(this.game.scene.root, this.game.scene.root, (a, b) => {
      if (!canEngage(a, b)) return;
      const { aDied, bDied } = resolveMinionCombat(a, b);
      if (aDied) this._killMinion(a);
      if (bDied) this._killMinion(b);
    });
  }

  // Minion-vs-Tower/Base engagement isn't detected by scene.overlap's full
  // AABB test (Tower/Base sit beside the Lane, not literally under a
  // Minion's walking height — see structures.js's xOverlap), so each live
  // Minion is checked directly against its own Lane's Tower, and — once that
  // Tower is destroyed — the enemy Base. Blocked at a live Tower this tick
  // means the Base is out of physical reach, gating per-Lane rather than
  // globally (a Minion never reaches another Lane's Base check at all).
  _resolveStructureDamage() {
    for (const minion of this.minions) {
      if (minion.hp <= 0) continue;
      const tower = this.towers[minion.laneIndex];
      if (canEngageTower(minion, tower)) {
        const { destroyed } = resolveStructureDamage(minion, tower);
        if (destroyed) this.game.net.despawn(tower.netId);
        continue;
      }
      if (tower.hp > 0) continue;
      for (const base of this.bases) {
        if (!canEngageBase(minion, base)) continue;
        const { destroyed } = resolveStructureDamage(minion, base);
        if (destroyed) this._endMatch(base.team);
      }
    }
  }

  _endMatch(losingTeam) {
    this.winner = TEAMS.find((t) => t !== losingTeam);
    this.game.net.setState({ winner: this.winner });
  }

  _spawnWaves(dt) {
    map.lanes.forEach((lane, laneIndex) => {
      for (const team of TEAMS) {
        const remaining = this.timers[laneIndex][team] - dt;
        if (remaining <= 0) {
          this.timers[laneIndex][team] = remaining + MINION_SPAWN_INTERVAL;
          this._spawn(lane, laneIndex, team);
        } else {
          this.timers[laneIndex][team] = remaining;
        }
      }
    });
  }

  _spawn(lane, laneIndex, team) {
    const [start, ...ahead] = laneWaypoints(lane, team);
    const minion = new Minion(start.x, start.y, team, laneIndex, ahead, TEAM_COLORS[team]);
    minion.netId = this.game.net.spawn("minion", minion);
    this.minions.push(minion);
  }

  _killMinion(minion) {
    this.game.net.despawn(minion.netId);
    const index = this.minions.indexOf(minion);
    if (index !== -1) this.minions.splice(index, 1);
  }

  // Spawns and tracks a Character's Primary Ability Projectile — called by
  // Character._firePrimary via `game.combatDirector` (see startMatch, which
  // assigns this Director there right after constructing it) rather than the
  // Character net.spawn'ing directly, so it joins `this.projectiles` for
  // lifetime/despawn bookkeeping. `this` is handed to the Projectile so it
  // can call back into resolveProjectileHit below from its own fixedUpdate.
  spawnProjectile(x, y, team, facing) {
    const projectile = new Projectile(x, y, team, facing, this);
    projectile.netId = this.game.net.spawn("projectile", projectile);
    this.projectiles.push(projectile);
  }

  // Called by a Projectile's own fixedUpdate right after it integrates this
  // tick's motion (see projectiles.js's Projectile.fixedUpdate and its class
  // comment on why the check has to happen there, not from this Director's
  // own fixedUpdate). Uses gamekit's Scene.overlapSwept — its swept (not just
  // end-of-tick) hit test, same as CLAUDE.md calls out for projectile combat —
  // since PROJECTILE_SPEED can otherwise step a Projectile clean over a thin
  // Minion within one tick. Sweeps the whole scene rather than just
  // minions/towers, same shape as _resolveMinionCombat's full-scene overlap;
  // canHit filters out everything else (Characters, other Projectiles).
  // Spent on its first hit, same one-shot rule as resolveStructureDamage's
  // Minion attacks.
  resolveProjectileHit(projectile) {
    this.game.scene.overlapSwept(projectile, this.game.scene.root, (proj, target) => {
      if (proj.spent || !canHit(proj, target)) return;
      const { destroyed } = applyProjectileDamage(proj, target);
      proj.spent = true;
      if (destroyed) {
        if (target instanceof Minion) this._killMinion(target);
        else this.game.net.despawn(target.netId);
      }
    });
  }

  // Resolves the melee Character's Primary Ability the instant it triggers
  // (see KITS above) — unlike a Projectile, there's no traveling entity or
  // lifetime to track, just one immediate scene.overlap against a hitbox in
  // front of `character` (see melee.js's meleeHitbox). Sweeps the whole scene
  // same as _resolveMinionCombat/resolveProjectileHit; canHitMelee filters to
  // enemy Minions/Towers/Characters. A Character reaching 0 hp is left as-is
  // — see melee.js's header comment on why (death/respawn is #9's scope).
  resolveMeleeSwing(character) {
    const hitbox = meleeHitbox(character);
    this.game.scene.overlap(hitbox, this.game.scene.root, (_hitbox, target) => {
      if (!canHitMelee(character, target)) return;
      const { destroyed } = applyMeleeDamage(target);
      if (!destroyed) return;
      if (target instanceof Minion) this._killMinion(target);
      else if (target instanceof Tower) this.game.net.despawn(target.netId);
    });
  }

  _despawnProjectiles() {
    this.projectiles = this.projectiles.filter((p) => {
      if (!p.spent && p.life > 0) return true;
      this.game.net.despawn(p.netId);
      return false;
    });
  }
}

// Builds and starts one ServerGame for a Room whose players are all ready,
// then hands each player's already-open connection to it — the "connected
// Character flow" from #1, entered once per Match instead of at process
// startup. `room.playerOrder` fixes the order `accept()` is called in, which
// is the same order NetServer assigns `PlayerInfo.index`, so `createPlayer`
// below can look a player's Team/Character choice back up by index.
function startMatch(room) {
  const players = room.playerOrder.map((id) => room.players.get(id));

  const game = new ServerGame(
    { width: WORLD_W, height: WORLD_H, tickRate: TICK_RATE },
    {
      playerType: "character",
      createPlayer: (info) => {
        const player = players[info.index];
        return new Character(
          TILE * 3 + info.index * TILE * 2,
          SPAWN_Y,
          player.team,
          player.character,
          game,
        );
      },
    },
  );

  for (const player of players) game.accept(player.transport);
  // Exposed on `game` so Character._firePrimary can reach it without a
  // constructor-order dependency: createPlayer above runs during
  // game.accept(), before this Director exists, but Character.fixedUpdate
  // (where firing happens) only runs after game.start() below.
  game.combatDirector = new MinionDirector(game);
  game.scene.add(game.combatDirector);
  game.start();
}

const lobby = new LobbyManager({ onMatchStart: startMatch });

const ws = new WebSocketServer();
ws.onConnection.add((conn) => lobby.handleConnection(new ServerTransport(conn)));
ws.listen(PORT, () => console.log(`multiplayer-game server on ws://localhost:${PORT}`));
