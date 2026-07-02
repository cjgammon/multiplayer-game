// client.js — browser client, rendered with WebGPU. Predicts + reconciles
// the local Character; remote Characters are interpolated ~100ms behind real
// time by NetClient (no config needed — see gamekit's NetClient).
import { Sprite, Tilemap, createEntityFactory } from "@cjgammon/gamekit";
import { NetScene, WebSocketTransport } from "@cjgammon/gamekit/net";
import {
  RenderGame,
  isWebGPUAvailable,
  mountUnsupportedNotice,
} from "@cjgammon/gamekit/renderer";
import {
  TICK_RATE, PORT,
  CHAR_W, CHAR_H, DRAG_X, MAX_VEL_X, MAX_VEL_Y,
  stepCharacter,
} from "./shared.js";
import { TILE, getMap, buildMapData, worldSize, TEAM_COLORS, TOWER_COLOR } from "./maps.js";
import { MINION_W, MINION_H } from "./minions.js";

const canvas = document.getElementById("view");

if (!isWebGPUAvailable()) {
  mountUnsupportedNotice(canvas);
} else {
  main();
}

async function main() {
  // Selects which Map to render — must match the server's MAP_ID env var
  // (both build the Tilemap locally from the same data; see maps.js).
  const mapId = new URLSearchParams(location.search).get("map") || "singleLane";
  const map = getMap(mapId);
  const { width: WORLD_W, height: WORLD_H } = worldSize(map);

  // Built locally from the same shared data the server uses — the map is
  // static, so it isn't sent over the wire; both sides must agree on it byte
  // for byte or client-side collision (prediction + collide) would diverge.
  const tilemap = new Tilemap(map.cols, map.rows, TILE, TILE, buildMapData(map));
  tilemap.tint = 0x445566;

  // Bases and Towers are static placeholder shapes (no art pipeline yet, no
  // HP/combat yet) — like the Tilemap, both sides can derive their positions
  // identically from Map data, so they're built locally rather than synced.
  function shape(def, tint) {
    const e = new Sprite();
    e.x = def.x;
    e.y = def.y;
    e.width = def.w;
    e.height = def.h;
    e.tint = tint;
    return e;
  }

  const staticEntities = [
    ...map.bases.map((b) => shape(b, TEAM_COLORS[b.team])),
    ...map.lanes.map((lane) => shape(lane.tower, TOWER_COLOR)),
  ];

  // Untextured Sprite → renders as a solid tinted box (no art pipeline yet).
  // Config (size/drag/maxVelocity) must match the server's Character exactly
  // so client-side prediction integrates identically.
  class CharacterView extends Sprite {
    constructor() {
      super();
      this.width = CHAR_W;
      this.height = CHAR_H;
      this.drag.set(DRAG_X, 0);
      this.maxVelocity.set(MAX_VEL_X, MAX_VEL_Y);
    }

    // Reads the payload the server's Character.netState() sends. gamekit
    // 0.2.0 restores velocity automatically before reconciliation replay;
    // grounded/prevJump are app-specific jump-edge state it doesn't know
    // about, so we still restore those ourselves — applyNetState is
    // guaranteed to run before the replay (see SimulateFn's doc comment).
    applyNetState(state) {
      if (!state) return;
      if (state.color !== undefined) this.tint = state.color;
      if (state.grounded !== undefined) this._grounded = state.grounded;
      if (state.prevJump !== undefined) this._prevJump = state.prevJump;
    }
  }

  // Untextured Sprite → renders as a solid tinted box, same as CharacterView.
  // Not predicted (no player drives a Minion) — NetClient interpolates it
  // like any other remote entity, from the position the server broadcasts.
  class MinionView extends Sprite {
    constructor() {
      super();
      this.width = MINION_W;
      this.height = MINION_H;
    }

    // Reads the payload the server's Minion.netState() sends.
    applyNetState(state) {
      if (!state) return;
      if (state.color !== undefined) this.tint = state.color;
    }
  }

  const factory = createEntityFactory({
    character: () => new CharacterView(),
    minion: () => new MinionView(),
  });

  class WorldScene extends NetScene {
    create() {
      this.add(tilemap);
      for (const entity of staticEntities) this.add(entity);
      this.camera.bounds = { minX: 0, minY: 0, maxX: WORLD_W, maxY: WORLD_H };
    }

    update(dt) {
      super.update(dt);
      // Start following the local Character as soon as it's spawned.
      // (gamekit 0.2.0 predicts the local player in Scene's preCamera seam,
      // before the camera follows, and spawns it with interpolate = true —
      // no app-side workaround needed for either anymore.)
      if (!this._following) {
        const local = this.client.entities.get(this.client.you);
        if (local) {
          this.camera.follow(local, 0.2);
          this.camera.snapToTarget();
          this._following = true;
        }
      }
    }
  }

  const transport = new WebSocketTransport(`ws://localhost:${PORT}`);
  const scene = new WorldScene(transport, factory, {
    // Predict OUR Character by running the SAME movement the server runs.
    simulate: (entity, input, dt) => stepCharacter(entity, input, dt, tilemap),
  });

  const game = await RenderGame.create(canvas, { fov: WORLD_W, tickRate: TICK_RATE });
  game.switchScene(scene);
  game.start();

  // Send input on change; prediction + sending happen each tick.
  const input = { left: false, right: false, jump: false };
  const KEYS = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    ArrowUp: "jump", KeyW: "jump", Space: "jump",
  };
  function setKey(e, down) {
    const dir = KEYS[e.code];
    if (!dir || input[dir] === down) return;
    input[dir] = down;
    scene.client.setLocalInput(input); // predicted + sent automatically
    e.preventDefault();
  }
  window.addEventListener("keydown", (e) => setKey(e, true));
  window.addEventListener("keyup", (e) => setKey(e, false));
}
