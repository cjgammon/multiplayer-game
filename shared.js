// shared.js — constants and the one movement function both the server (real
// simulation) and the client (local prediction + reconciliation replay)
// call. Map data itself (Lanes, Bases, Towers, Tilemap grid) lives in
// maps.js — see its header comment for why it's shared/local rather than
// networked.
import { Entity } from "@cjgammon/gamekit";

export const TICK_RATE = 20; // fixed ticks/sec, server and client

// WebSocket port, server and client. Overridable so multiple git worktrees
// (see wt-preview) can each run their own server without colliding on
// 39500 — server.js reads it from process.env.PORT, client.js (bundled by
// Vite) from import.meta.env.VITE_WS_PORT.
const envPort =
  (typeof process !== "undefined" && process.env && process.env.PORT) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_WS_PORT);
export const PORT = Number(envPort) || 39500;

export const TILE = 16;

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

// Lobby: the two Teams a player can join, and the Character roster a player
// can pick from. Only one Character exists so far (from #1); later slices
// (#8) add entries here without changing the lobby/select flow's shape.
// Bases in maps.js use these same "A"/"B" ids for their `team` field.
export const TEAMS = ["A", "B"];
export const TEAM_COLORS = { A: 0xe8543e, B: 0x3ea1e8 };
export const CHARACTERS = [{ id: "naut", name: "Naut" }];

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
