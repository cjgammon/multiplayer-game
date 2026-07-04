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
  CHAR_W, CHAR_H, CHAR_HP, DRAG_X, MAX_VEL_X, MAX_VEL_Y, TEAM_COLORS, CHARACTERS,
  stepCharacter,
} from "../shared/shared.js";
import { stepPrimaryAbility } from "./abilities.js";
import { getMap, buildMapData, worldSize } from "../shared/maps.js";
import { LobbyManager } from "./room.js";
import { Minion, canEngage, resolveMinionCombat, laneWaypoints, MINION_SPAWN_INTERVAL } from "../shared/minions.js";
import { Tower, Base } from "./structures.js";
import { Projectile } from "./projectiles.js";
import { PROJECTILE_W, PROJECTILE_H, PROJECTILE_COOLDOWN } from "../shared/projectiles.js";
import { meleeHitbox } from "./melee.js";
import { MELEE_COOLDOWN } from "../shared/melee.js";
import {
  SolarPickup, SOLAR_PER_MINION, SOLAR_PER_CHARACTER,
  canCollect, resolveCollect, canPurchaseUpgrade, resolvePurchaseUpgrade,
} from "../shared/solar.js";
import { downCharacter, stepRespawn, teamSpawnPoint } from "./respawn.js";
import { resolveStructureCombat, resolveProjectileHit as resolveHit, resolveMeleeHit } from "./combat.js";
import { pickNetState, CHARACTER_STATE } from "../shared/protocol.js";

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
      character.game.combatDirector.spawnProjectile(
        x, y, character.team, character.facing, character.damageMultiplier,
      );
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
  input = { left: false, right: false, jump: false, fire: false, dash: false, buyUpgrade: null };
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
  // Server-authoritative — not predicted, same as Minion/Tower/Base hp.
  // netState'd (below) only for the client's dev HP HUD; nothing in
  // stepCharacter/reconciliation reads it back.
  hp = CHAR_HP;
  // Solar economy (see solar.js and #10's acceptance criteria): a running
  // total of Solar collected from SolarPickups, which upgradeId Upgrades
  // have already been bought this Match (so each can only be bought once),
  // and the stat multipliers those Upgrades apply. Server-authoritative
  // only, same as hp — damageMultiplier is read by melee.js's
  // applyMeleeDamage / this file's KITS[0].fire (server-only, so it never
  // needs to round-trip to the client); speedMultiplier is read by
  // shared.js's stepCharacter, which the client also runs for prediction,
  // so it (like grounded/prevJump) must round-trip through
  // netState()/applyNetState() below.
  solar = 0;
  upgrades = {};
  damageMultiplier = 1;
  speedMultiplier = 1;
  // Death/respawn (#9) — set by respawn.js's downCharacter once melee.js's
  // swing brings hp to 0 (see MinionDirector.resolveMeleeSwing below).
  // `downed` is netState'd (below) so the client can hide the sprite; the
  // countdown itself is server-authoritative only, same as hp.
  downed = false;
  respawnTimer = 0;

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
  // the Primary Ability's cooldown/facing/fire-edge state (see #6), its
  // kit-specific effect (see the KITS table above), and an Upgrade purchase
  // request (see #10) — edge-triggered the same way stepPrimaryAbility
  // edge-triggers `fire`, since a purchase is a one-shot action like firing,
  // not continuously-held movement input. While downed (#9), skips all of
  // that — no input-driven movement, firing, or purchasing — and just counts
  // down the respawn timer instead, so a dead Character is removed from play
  // in-place rather than lingering (see respawn.js's header comment on why
  // this can't be a real net.spawn/despawn round-trip).
  fixedUpdate(dt) {
    if (this.downed) {
      stepRespawn(this, dt, this.game.combatDirector.baseForTeam(this.team));
      return;
    }
    stepCharacter(this, this.input, dt, tilemap);
    if (stepPrimaryAbility(this, this.input, dt, this.kit.cooldown)) this.kit.fire(this);
    const upgradeId = this.input.buyUpgrade;
    if (upgradeId && upgradeId !== this._prevBuyUpgrade) {
      this.game.combatDirector.tryPurchaseUpgrade(this, upgradeId);
    }
    this._prevBuyUpgrade = upgradeId;
  }

  // Per-entity payload the client reads via CharacterView.applyNetState —
  // see protocol.js's CHARACTER_STATE for the field list. Besides color,
  // this carries grounded/prevJump: gamekit 0.2.0 restores velocity
  // automatically before reconciliation replay (SnapshotEntity now carries
  // vx/vy), but grounded/prevJump are app-specific jump-edge state the
  // engine doesn't know about — stale values here let a replayed tick
  // re-fire or drop a jump. applyNetState is guaranteed to run before the
  // replay (see SimulateFn's doc comment in gamekit). speedMultiplier is
  // included for the same reason: shared.js's stepCharacter (the replayed
  // function) reads it, so a stale local value would replay at the wrong
  // speed. `solar` is included purely for HUD display — not read by any
  // predicted/replayed logic. damageMultiplier is deliberately omitted:
  // it's only read server-side (melee.js's applyMeleeDamage, this file's
  // KITS[0].fire), so the client never needs a copy. `downed` (#9) lets the
  // client hide the sprite while it's out of play; `hp` drives the dev HP
  // HUD only — no gameplay logic client-side reads it. `character` is
  // deliberately omitted too: nothing on the client reads it (see
  // protocol.js's header comment).
  netState() {
    return pickNetState(this, CHARACTER_STATE);
  }
}

// Drives Minion waves, same-Lane combat, Character Primary Abilities, and
// the Solar economy for a Match, independent of any connection — see
// acceptance criteria on #4 ("no player input required"). Not net.spawn'd
// itself (no visual representation to sync); startMatch below adds one to
// each Match's Scene ahead of any Minion, so its fixedUpdate (combat
// resolution, then spawning) always runs before theirs within the same
// tick, letting a Minion's own fixedUpdate see this tick's `engaged` flag
// the moment it's set.
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
    this._resolveSolarCollection();
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

  // Credits any Character overlapping a live SolarPickup (see solar.js) and
  // despawns it — same full-scene overlap shape as _resolveMinionCombat,
  // just Character-vs-pickup instead of Minion-vs-Minion. `pickup.collected`
  // (checked by canCollect) guards the same same-pass double-resolution race
  // canEngage's hp>0 check guards for Minion combat — see solar.js's
  // SolarPickup class comment. Not combat.js's concern (see its header
  // comment) — a two-line dispatch, no eligibility/damage math to
  // consolidate.
  _resolveSolarCollection() {
    this.game.scene.overlap(this.game.scene.root, this.game.scene.root, (a, b) => {
      const [character, pickup] = a instanceof SolarPickup ? [b, a] : [a, b];
      if (!(pickup instanceof SolarPickup) || !(character instanceof Character)) return;
      if (!canCollect(character, pickup)) return;
      resolveCollect(character, pickup);
      this.game.net.despawn(pickup.netId);
    });
  }

  // Spawns a collectible SolarPickup at a defeated Minion's or Character's
  // death location — see _killMinion and resolveMeleeSwing below.
  dropSolar(x, y, amount) {
    const pickup = new SolarPickup(x, y, amount);
    pickup.netId = this.game.net.spawn("solar", pickup);
    return pickup;
  }

  // Resolves a Character's Upgrade purchase request (see Character.fixedUpdate
  // above): finds that Character's own Team's Base and hands off to solar.js's
  // canPurchaseUpgrade/resolvePurchaseUpgrade, the same
  // check-then-resolve shape combat.js's resolvers use for combat. A no-op if
  // the Character isn't at their own Base, can't afford it, or already bought
  // it this Match. Not combat.js's concern — economy, not combat.
  tryPurchaseUpgrade(character, upgradeId) {
    const base = this.bases.find((b) => b.team === character.team);
    if (!base || !canPurchaseUpgrade(character, base, upgradeId)) return;
    resolvePurchaseUpgrade(character, upgradeId);
  }

  // Same-Lane, opposing-Team Minion pairs only — a converging multi-Lane Map
  // (see maps.js's twinLanes) can put different Lanes' Minions in physical
  // overlap, so laneIndex is checked (via canEngage) in addition to the AABB
  // test itself. Calls minions.js directly, not combat.js — nothing to
  // consolidate beyond this two-line dispatch (see combat.js's header
  // comment).
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
  // Minion's walking height — see structures.js's xOverlap), so combat.js's
  // resolveStructureCombat walks each live Minion directly against its own
  // Lane's Tower, and — once that Tower is destroyed — the enemy Base. This
  // method just applies the events it reports via `net`/`_endMatch`.
  _resolveStructureDamage() {
    for (const event of resolveStructureCombat(this.minions, this.towers, this.bases)) {
      if (event.type === "towerDestroyed") this.game.net.despawn(event.tower.netId);
      else this._endMatch(event.base.team);
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
    this.dropSolar(minion.x, minion.y, SOLAR_PER_MINION);
    this.game.net.despawn(minion.netId);
    const index = this.minions.indexOf(minion);
    if (index !== -1) this.minions.splice(index, 1);
  }

  // A Team's own Base, for a downed Character to respawn at (see #9's
  // Character.fixedUpdate) — named accessor rather than reaching into
  // `this.bases` directly, same shape as spawnProjectile/resolveMeleeSwing
  // below.
  baseForTeam(team) {
    return this.bases.find((b) => b.team === team);
  }

  // Spawns and tracks a Character's Primary Ability Projectile — called by
  // Character._firePrimary via `game.combatDirector` (see startMatch, which
  // assigns this Director there right after constructing it) rather than the
  // Character net.spawn'ing directly, so it joins `this.projectiles` for
  // lifetime/despawn bookkeeping. `this` is handed to the Projectile so it
  // can call back into resolveProjectileHit below from its own fixedUpdate.
  spawnProjectile(x, y, team, facing, damageMultiplier) {
    const projectile = new Projectile(x, y, team, facing, this, damageMultiplier);
    projectile.netId = this.game.net.spawn("projectile", projectile);
    this.projectiles.push(projectile);
  }

  // Applies a destroyed target's despawn/down response — shared by
  // resolveProjectileHit and resolveMeleeSwing below, both of which resolve
  // a hit via combat.js and get back a `targetKind` ("minion" | "tower" |
  // "character") to dispatch on. A Character reaching 0 hp is downed (#9,
  // see respawn.js's downCharacter) rather than despawned — the same
  // non-elimination flow either Ability triggers — and drops Solar first,
  // same as a killed Minion.
  _applyKill(target, targetKind) {
    if (targetKind === "minion") this._killMinion(target);
    else if (targetKind === "tower") this.game.net.despawn(target.netId);
    else {
      this.dropSolar(target.x, target.y, SOLAR_PER_CHARACTER);
      downCharacter(target);
    }
  }

  // Called by a Projectile's own fixedUpdate right after it integrates this
  // tick's motion (see projectiles.js's Projectile.fixedUpdate and its class
  // comment on why the check has to happen there, not from this Director's
  // own fixedUpdate). Uses gamekit's Scene.overlapSwept — its swept (not just
  // end-of-tick) hit test, same as CLAUDE.md calls out for projectile combat —
  // since PROJECTILE_SPEED can otherwise step a Projectile clean over a thin
  // Minion within one tick. Sweeps the whole scene rather than just
  // minions/towers; combat.js's resolveProjectileHit filters to enemy
  // Minions/Towers/Characters via canHit and reports the result for this
  // method to apply via _applyKill.
  resolveProjectileHit(projectile) {
    this.game.scene.overlapSwept(projectile, this.game.scene.root, (proj, target) => {
      const { destroyed, targetKind } = resolveHit(proj, target);
      if (destroyed) this._applyKill(target, targetKind);
    });
  }

  // Resolves the melee Character's Primary Ability the instant it triggers
  // (see KITS above) — unlike a Projectile, there's no traveling entity or
  // lifetime to track, just one immediate scene.overlap against a hitbox in
  // front of `character` (see melee.js's meleeHitbox). Sweeps the whole scene
  // same as _resolveMinionCombat/resolveProjectileHit; combat.js's
  // resolveMeleeHit filters to enemy Minions/Towers/Characters and reports
  // the result for this method to apply via _applyKill.
  resolveMeleeSwing(character) {
    const hitbox = meleeHitbox(character);
    this.game.scene.overlap(hitbox, this.game.scene.root, (_hitbox, target) => {
      const { destroyed, targetKind } = resolveMeleeHit(character, target);
      if (destroyed) this._applyKill(target, targetKind);
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
        // Spawns at the player's own Team's Base — with up to MAX_TEAM_SIZE
        // (3) Characters per Team (#11), spawning by global join order
        // instead could put a Team B player on Team A's side of the Map.
        // teamSpawnPoint spreads this Team's Characters across the Base's
        // own width (rather than respawn.js's stepRespawn, which always
        // returns a downed Character solo to dead-center) so a full Team
        // doesn't spawn stacked on itself.
        const base = game.combatDirector.baseForTeam(player.team);
        const teammates = players.filter((p) => p.team === player.team);
        const indexOnTeam = teammates.indexOf(player);
        const { x, y } = teamSpawnPoint(base, CHAR_W, indexOnTeam, teammates.length);
        return new Character(x, y, player.team, player.character, game);
      },
    },
  );

  // Built before game.accept() below (unlike the Towers/Bases it net.spawns,
  // this only needs game.net, which the ServerGame constructor above already
  // set up) so createPlayer's baseForTeam lookup above has something to find
  // — accept() is what triggers createPlayer, via NetServer.
  game.combatDirector = new MinionDirector(game);
  game.scene.add(game.combatDirector);
  for (const player of players) game.accept(player.transport);
  game.start();
}

const lobby = new LobbyManager({ onMatchStart: startMatch });

const ws = new WebSocketServer();
ws.onConnection.add((conn) => lobby.handleConnection(new ServerTransport(conn)));
ws.listen(PORT, () => console.log(`multiplayer-game server on ws://localhost:${PORT}`));
