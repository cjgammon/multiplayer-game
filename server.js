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
  CHAR_W, CHAR_H, DRAG_X, MAX_VEL_X, MAX_VEL_Y, SPAWN_Y, TEAM_COLORS,
  stepCharacter,
} from "./shared.js";
import { getMap, buildMapData, worldSize } from "./maps.js";
import { LobbyManager } from "./room.js";
import { Minion, canEngage, resolveMinionCombat, laneWaypoints, MINION_SPAWN_INTERVAL } from "./minions.js";

// Selects which Map to run — the client must be pointed at the same one
// (its `?map=` query param) since both sides build the Tilemap locally.
const map = getMap(process.env.MAP_ID || "singleLane");
const { width: WORLD_W, height: WORLD_H } = worldSize(map);

const tilemap = new Tilemap(map.cols, map.rows, TILE, TILE, buildMapData(map));

class Character extends Entity {
  // The server sets this from the client's latest input each tick.
  input = { left: false, right: false, jump: false };

  constructor(x, y, team, character) {
    super(x, y);
    this.width = CHAR_W;
    this.height = CHAR_H;
    this.drag.set(DRAG_X, 0);
    this.maxVelocity.set(MAX_VEL_X, MAX_VEL_Y);
    this.color = TEAM_COLORS[team];
    this.character = character;
  }

  // The authoritative simulation: gravity, run, jump, tilemap collision.
  fixedUpdate(dt) {
    stepCharacter(this, this.input, dt, tilemap);
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
    };
  }
}

// Drives Minion waves and same-Lane combat for a Match, independent of any
// connection — see acceptance criteria on #4 ("no player input required").
// Not net.spawn'd itself (no visual representation to sync); startMatch below
// adds one to each Match's Scene ahead of any Minion, so its fixedUpdate
// (combat resolution, then spawning) always runs before theirs within the
// same tick, letting a Minion's own fixedUpdate see this tick's `engaged`
// flag the moment it's set.
class MinionDirector extends Entity {
  constructor(game) {
    super();
    this.game = game;
    // One spawn countdown per Lane per Team, seeded at 0 so the first wave on
    // each Lane appears immediately rather than after a full wait.
    this.timers = map.lanes.map(() => Object.fromEntries(TEAMS.map((t) => [t, 0])));
  }

  fixedUpdate(dt) {
    this._resolveCombat();
    this._spawnWaves(dt);
  }

  // Same-Lane, opposing-Team Minion pairs only — a converging multi-Lane Map
  // (see maps.js's twinLanes) can put different Lanes' Minions in physical
  // overlap, so laneIndex is checked (via canEngage) in addition to the AABB
  // test itself.
  _resolveCombat() {
    this.game.scene.overlap(this.game.scene.root, this.game.scene.root, (a, b) => {
      if (!canEngage(a, b)) return;
      const { aDied, bDied } = resolveMinionCombat(a, b);
      if (aDied) this.game.net.despawn(a.netId);
      if (bDied) this.game.net.despawn(b.netId);
    });
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
        );
      },
    },
  );

  for (const player of players) game.accept(player.transport);
  game.scene.add(new MinionDirector(game));
  game.start();
}

const lobby = new LobbyManager({ onMatchStart: startMatch });

const ws = new WebSocketServer();
ws.onConnection.add((conn) => lobby.handleConnection(new ServerTransport(conn)));
ws.listen(PORT, () => console.log(`multiplayer-game server on ws://localhost:${PORT}`));
