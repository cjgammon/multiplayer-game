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
  TICK_RATE, PORT, TILE,
  CHAR_W, CHAR_H, DRAG_X, MAX_VEL_X, MAX_VEL_Y, SPAWN_Y, TEAM_COLORS,
  stepCharacter,
} from "./shared.js";
import { getMap, buildMapData, worldSize } from "./maps.js";
import { LobbyManager } from "./room.js";

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
  game.start();
}

const lobby = new LobbyManager({ onMatchStart: startMatch });

const ws = new WebSocketServer();
ws.onConnection.add((conn) => lobby.handleConnection(new ServerTransport(conn)));
ws.listen(PORT, () => console.log(`multiplayer-game server on ws://localhost:${PORT}`));
