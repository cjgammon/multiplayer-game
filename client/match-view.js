// match-view.js — the client-side render/interpolation half of a Match:
// per-entity-type Views (Sprite subclasses reading server netState) and the
// NetScene that spawns/interpolates them. Deliberately excludes DOM
// bootstrap, keyboard input, and lobby wiring — see client.js, which is the
// only thing that touches `document`/`window`. None of this needs a DOM or
// WebGPU context to construct: Sprite and NetScene are plain data/logic
// classes, so this module is importable and its Views are directly
// constructible in a test (see tests/match-view.test.js). Per-frame DOM
// updates driven by the local Character (Solar/HP HUD) are the caller's
// job too — see createWorldScene's `onLocalUpdate` option below — so this
// module never needs a DOM to construct or test.
import { Sprite, createEntityFactory } from "@cjgammon/gamekit";
import { NetScene } from "@cjgammon/gamekit/net";
import { CHAR_W, CHAR_H, DRAG_X, MAX_VEL_X, MAX_VEL_Y } from "../shared/shared.js";
import { TOWER_COLOR, TOWER_SIZE, BASE_SIZE } from "../shared/maps.js";
import { MINION_W, MINION_H } from "../shared/minions.js";
import { PROJECTILE_W, PROJECTILE_H } from "../shared/projectiles.js";
import { SOLAR_PICKUP_SIZE } from "../shared/solar.js";
import {
  applyNetState as applyState,
  CHARACTER_STATE, MINION_STATE, BASE_STATE, PROJECTILE_STATE, SOLAR_STATE,
} from "../shared/protocol.js";

// Untextured Sprite → renders as a solid tinted box (no art pipeline yet).
// Config (size/drag/maxVelocity) must match the server's Character exactly
// so client-side prediction integrates identically.
export class CharacterView extends Sprite {
  // Secondary Ability (dash) state — mirrors server.js's Character fields
  // since shared.js's stepCharacter (the scene's `simulate`, wired up by
  // client.js) reads/writes them during prediction and reconciliation
  // replay.
  facing = 1;
  dashCooldown = 0;
  dashTimer = 0;
  // Solar economy (see #10): speedMultiplier is read by stepCharacter during
  // prediction/replay, same reason dash* round-trips above; solar is
  // display-only (read by client.js's HUD update via onLocalUpdate).
  speedMultiplier = 1;
  solar = 0;
  // Downed (#9) — mirrors server.js's Character field so the `simulate`
  // callback (in client.js) can skip predicting movement for a Character
  // that's out of play, same as the server's Character.fixedUpdate does.
  downed = false;
  // Dev HP HUD only (see client.js's updateHpHud) — no gameplay logic reads
  // this client-side.
  hp = 0;

  constructor() {
    super();
    this.width = CHAR_W;
    this.height = CHAR_H;
    this.drag.set(DRAG_X, 0);
    this.maxVelocity.set(MAX_VEL_X, MAX_VEL_Y);
  }

  // Reads the payload the server's Character.netState() sends — see
  // protocol.js's CHARACTER_STATE for the field list. gamekit 0.2.0
  // restores velocity automatically before reconciliation replay;
  // grounded/prevJump/facing/dash* are app-specific state stepCharacter
  // reads/writes that it doesn't know about, so we still restore those
  // ourselves — applyNetState is guaranteed to run before the replay (see
  // SimulateFn's doc comment). Downed (#9) fans out to both `downed` and
  // `visible` — see protocol.js's CHARACTER_STATE entry for why: hidden
  // rather than despawned, since the server keeps simulating/networking the
  // same entity through its respawn timer (see respawn.js's header comment).
  applyNetState(state) {
    applyState(this, state, CHARACTER_STATE);
  }
}

// Untextured Sprite → renders as a solid tinted box, same as CharacterView.
// Not predicted (no player drives a Minion) — NetClient interpolates it
// like any other remote entity, from the position the server broadcasts.
export class MinionView extends Sprite {
  constructor() {
    super();
    this.width = MINION_W;
    this.height = MINION_H;
  }

  // Reads the payload the server's Minion.netState() sends — see
  // protocol.js's MINION_STATE for the field list.
  applyNetState(state) {
    applyState(this, state, MINION_STATE);
  }
}

// Bases and Towers are server-authoritative net.spawn entities (see
// structures.js and server.js's MinionDirector) — HP/destruction lives
// there, so the client just renders whatever position/state the server
// sends, same as Minion.
export class TowerView extends Sprite {
  constructor() {
    super();
    this.width = TOWER_SIZE;
    this.height = TOWER_SIZE;
    this.tint = TOWER_COLOR;
  }
}

export class BaseView extends Sprite {
  constructor() {
    super();
    this.width = BASE_SIZE;
    this.height = BASE_SIZE;
  }

  // Reads the payload the server's Base.netState() sends — see protocol.js's
  // BASE_STATE for the field list.
  applyNetState(state) {
    applyState(this, state, BASE_STATE);
  }
}

// Untextured Sprite → renders as a solid tinted box, same as MinionView.
// Not predicted (see abilities.js's stepPrimaryAbility comment — only the
// dash Secondary Ability is client-predicted): NetClient interpolates it
// from the position the server broadcasts, like a Minion.
export class ProjectileView extends Sprite {
  constructor() {
    super();
    this.width = PROJECTILE_W;
    this.height = PROJECTILE_H;
  }

  // Reads the payload the server's Projectile.netState() sends — see
  // protocol.js's PROJECTILE_STATE for the field list.
  applyNetState(state) {
    applyState(this, state, PROJECTILE_STATE);
  }
}

// Untextured Sprite → renders as a solid tinted box, same as MinionView. Not
// predicted (no player drives a pickup, and collecting one has no
// latency-sensitive feedback that needs prediction — see solar.js's header
// comment): NetClient interpolates it like any other remote entity. No
// applyNetState — SOLAR_STATE is empty (see protocol.js), since nothing
// dynamic is rendered; the fixed gold tint is set once at construction.
export class SolarPickupView extends Sprite {
  constructor() {
    super();
    this.width = SOLAR_PICKUP_SIZE;
    this.height = SOLAR_PICKUP_SIZE;
    this.tint = 0xffd700;
  }

  applyNetState(state) {
    applyState(this, state, SOLAR_STATE);
  }
}

const entityFactory = createEntityFactory({
  character: () => new CharacterView(),
  minion: () => new MinionView(),
  tower: () => new TowerView(),
  base: () => new BaseView(),
  projectile: () => new ProjectileView(),
  solar: () => new SolarPickupView(),
});

/**
 * Builds the Scene for a Match: spawns/interpolates the Views above over
 * `transport`, renders `tilemap`, and follows the local Character once it's
 * spawned. `tilemap` and `worldBounds` are given rather than built here
 * since the caller (client.js) also needs `tilemap` directly for its own
 * `simulate` callback (client-side prediction must run the same movement
 * the server runs — see shared.js's stepCharacter). `onLocalUpdate(local,
 * client)`, if given, runs once per frame once the local Character has
 * spawned — the seam for the caller's own DOM updates (Solar/HP HUD) that
 * this module deliberately doesn't touch itself (see the header comment).
 */
export function createWorldScene({ transport, tilemap, worldBounds, simulate, onLocalUpdate }) {
  class WorldScene extends NetScene {
    create() {
      this.add(tilemap);
      this.camera.bounds = worldBounds;
    }

    update(dt) {
      super.update(dt);
      const local = this.client.entities.get(this.client.you);
      if (!local) return;
      // Start following the local Character as soon as it's spawned.
      // (gamekit 0.2.0 predicts the local player in Scene's preCamera seam,
      // before the camera follows, and spawns it with interpolate = true —
      // no app-side workaround needed for either anymore.)
      if (!this._following) {
        this.camera.follow(local, 0.2);
        this.camera.snapToTarget();
        this._following = true;
      }
      if (onLocalUpdate) onLocalUpdate(local, this.client);
    }
  }

  return new WorldScene(transport, entityFactory, { simulate });
}
