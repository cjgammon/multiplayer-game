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
  TICK_RATE, PORT, TILE, MAP_COLS, MAP_ROWS, WORLD_W, WORLD_H,
  CHAR_W, CHAR_H, DRAG_X, MAX_VEL_X, MAX_VEL_Y,
  buildMapData, stepCharacter,
} from "./shared.js";

const canvas = document.getElementById("view");

if (!isWebGPUAvailable()) {
  mountUnsupportedNotice(canvas);
} else {
  main();
}

async function main() {
  // Built locally from the same shared data the server uses — the map is
  // static, so it isn't sent over the wire; both sides must agree on it byte
  // for byte or client-side collision (prediction + collide) would diverge.
  const tilemap = new Tilemap(MAP_COLS, MAP_ROWS, TILE, TILE, buildMapData());
  tilemap.tint = 0x445566;

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

    // Reads the payload the server's Character.netState() sends. Restoring
    // velocity/_grounded/_prevJump here matters for the LOCAL Character:
    // NetClient delivers this payload just before _reconcileLocal resets
    // x/y to the snapshot and replays unacked inputs — without it the replay
    // integrates gravity from a velocity K ticks ahead of the auth state,
    // popping the character a few pixels on every snapshot during a jump.
    // For remote Characters the kinematic fields are inert (they're passive
    // and interpolated), but color applies to everyone.
    applyNetState(state) {
      if (!state) return;
      if (state.color !== undefined) this.tint = state.color;
      if (state.vx !== undefined) this.velocity.set(state.vx, state.vy);
      if (state.grounded !== undefined) this._grounded = state.grounded;
      if (state.prevJump !== undefined) this._prevJump = state.prevJump;
    }
  }

  const factory = createEntityFactory({
    character: () => new CharacterView(),
  });

  class WorldScene extends NetScene {
    create() {
      this.add(tilemap);
      this.camera.bounds = { minX: 0, minY: 0, maxX: WORLD_W, maxY: WORLD_H };
    }

    // NetScene's own fixedUpdate calls super.fixedUpdate() — which advances
    // the camera via Camera.update() — BEFORE client.predict() moves the
    // local Character for this tick. That leaves the camera always one tick
    // behind the Character it's following: imperceptible for slow, steady
    // horizontal motion, but visible as jitter during a jump's large,
    // fast-changing vertical velocity. Reproduce Scene.fixedUpdate's steps
    // here with predict() moved before the camera follows, so it tracks
    // this tick's freshly predicted position instead of last tick's.
    fixedUpdate(dt) {
      this.root.syncPrev();
      this.root.fixedUpdate(dt);
      this.client.predict();
      this.camera.update(dt);
      this.hud.syncPrev();
      this.hud.fixedUpdate(dt);
    }

    update(dt) {
      super.update(dt);
      // Start following the local Character as soon as it's spawned.
      if (!this._following) {
        const local = this.client.entities.get(this.client.you);
        if (local) {
          // NetClient spawns every entity with interpolate = false, assuming
          // the net layer already smooths it — true for remotes (a fresh
          // position every render frame from the Interpolator), but not for
          // the local entity: prediction only advances once per fixed tick
          // (TICK_RATE, 20Hz), well below render rate, so without this it's
          // drawn at a static position for ~3 frames then jumps — visible as
          // stutter, worst on the large per-tick position deltas of a jump.
          // Turning interpolate back on lerps prevX/Y -> x/y across render
          // frames, same as any single-player Entity.
          local.interpolate = true;
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
