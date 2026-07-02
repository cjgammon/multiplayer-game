// server.js — authoritative server. Run with Node (not Bun): the
// from-scratch WebSocket server needs Node's `http` upgrade handshake.
import { ServerGame, WebSocketServer, ServerTransport } from "@cjgammon/gamekit-server";
import { Entity, Tilemap } from "@cjgammon/gamekit";
import {
  TICK_RATE, PORT,
  CHAR_W, CHAR_H, DRAG_X, MAX_VEL_X, MAX_VEL_Y, SPAWN_Y,
  stepCharacter,
} from "./shared.js";
import { TILE, getMap, buildMapData, worldSize } from "./maps.js";

// A handful of distinguishable tints, cycling for more than 4 players.
const COLORS = [0xe8543e, 0x3ea1e8, 0x4bd17c, 0xe8c93e];

// Selects which Map to run — the client must be pointed at the same one
// (its `?map=` query param) since both sides build the Tilemap locally.
const map = getMap(process.env.MAP_ID || "singleLane");
const { width: WORLD_W, height: WORLD_H } = worldSize(map);

const tilemap = new Tilemap(map.cols, map.rows, TILE, TILE, buildMapData(map));

class Character extends Entity {
  // The server sets this from the client's latest input each tick.
  input = { left: false, right: false, jump: false };

  constructor(x, y, color) {
    super(x, y);
    this.width = CHAR_W;
    this.height = CHAR_H;
    this.drag.set(DRAG_X, 0);
    this.maxVelocity.set(MAX_VEL_X, MAX_VEL_Y);
    this.color = color;
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
    return { color: this.color, grounded: this._grounded, prevJump: this._prevJump };
  }
}

const game = new ServerGame(
  { width: WORLD_W, height: WORLD_H, tickRate: TICK_RATE },
  {
    // The client factory registers this tag under "character" — must match.
    playerType: "character",
    // Spawn one Character per connection, spread out along the floor.
    createPlayer: (info) =>
      new Character(
        TILE * 3 + info.index * TILE * 2,
        SPAWN_Y,
        COLORS[info.index % COLORS.length],
      ),
  },
);

const ws = new WebSocketServer();
ws.onConnection.add((conn) => game.accept(new ServerTransport(conn)));
ws.listen(PORT, () => console.log(`multiplayer-game server on ws://localhost:${PORT}`));
game.start();
