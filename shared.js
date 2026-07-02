// shared.js — constants, map data, and the one movement function both the
// server (real simulation) and the client (local prediction + reconciliation
// replay) call. Both sides must build an identical Tilemap from
// `buildMapData()`; the map is static and known at build time, so it isn't
// networked.
import { Entity } from "@cjgammon/gamekit";

export const TICK_RATE = 20; // fixed ticks/sec, server and client

export const TILE = 16;
export const MAP_COLS = 40;
export const MAP_ROWS = 16;
export const WORLD_W = MAP_COLS * TILE; // 640
export const WORLD_H = MAP_ROWS * TILE; // 256

export const CHAR_W = 14;
export const CHAR_H = 20;

// Platform-style movement tuning.
export const RUN_ACCEL = 900;
export const DRAG_X = 900;
export const MAX_VEL_X = 140;
export const MAX_VEL_Y = 360;
export const GRAVITY = 900;
export const JUMP_VELOCITY = 340;

export const SPAWN_Y = TILE * 2;

/** An empty arena: solid floor + side walls, nothing else. */
export function buildMapData() {
  const data = new Array(MAP_COLS * MAP_ROWS).fill(0);
  for (let col = 0; col < MAP_COLS; col++) {
    data[(MAP_ROWS - 1) * MAP_COLS + col] = 1; // floor
  }
  for (let row = 0; row < MAP_ROWS; row++) {
    data[row * MAP_COLS] = 1; // left wall
    data[row * MAP_COLS + MAP_COLS - 1] = 1; // right wall
  }
  return data;
}

function isGrounded(entity, tilemap) {
  const footY = entity.y + entity.height + 1;
  return (
    tilemap.isSolid(tilemap.getTileAtWorld(entity.x + 1, footY)) ||
    tilemap.isSolid(tilemap.getTileAtWorld(entity.x + entity.width - 1, footY))
  );
}

/**
 * Advance a Character one fixed step: run + gravity + edge-triggered jump +
 * tilemap collision. Called identically by the server's authoritative
 * `fixedUpdate` and the client's prediction/reconciliation `simulate` — must
 * stay a pure function of (entity, input, dt, tilemap) so both sides agree.
 *
 * Uses `Entity.prototype.fixedUpdate` directly (not `entity.fixedUpdate()`)
 * so it integrates via the base accel→drag→clamp→position step regardless of
 * whether `entity` is a subclass that overrides `fixedUpdate` to call this.
 */
export function stepCharacter(entity, input, dt, tilemap) {
  entity.acceleration.x = 0;
  if (input.left) entity.acceleration.x -= RUN_ACCEL;
  if (input.right) entity.acceleration.x += RUN_ACCEL;
  entity.acceleration.y = GRAVITY;

  if (input.jump && !entity._prevJump && entity._grounded) {
    entity.velocity.y = -JUMP_VELOCITY;
  }
  entity._prevJump = !!input.jump;

  Entity.prototype.fixedUpdate.call(entity, dt);

  tilemap.collide(entity);
  entity._grounded = isGrounded(entity, tilemap);
}
