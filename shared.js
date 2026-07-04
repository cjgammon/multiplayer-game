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

// Secondary Ability: dash. Predicted client-side (see NetClient.predict /
// _reconcileLocal) and reconciled the same way base movement is — unlike the
// Primary Ability projectile (server-only, see projectiles.js), so its state
// (facing/dashCooldown/dashTimer/_prevDash) lives on the Character itself and
// is driven from stepCharacter below, the one function both sides call.
export const DASH_SPEED = 320; // px/s, well above MAX_VEL_X
export const DASH_DURATION = 0.15; // seconds the burst lasts
export const DASH_COOLDOWN = 1.5; // seconds between dashes

export const SPAWN_Y = TILE * 2;

// Character HP — server-authoritative only; not predicted or netState'd,
// same as Minion/Tower/Base hp, since no Ability that damages a Character
// (melee.js's swing) is client-predicted either. Death/respawn handling is
// #9's scope, not this one's — a Character can reach 0 here and just sit at
// 0 until #9 adds a response.
export const CHAR_HP = 100;

// Lobby: the two Teams a player can join, and the Character roster a player
// can pick from. Bases in maps.js use these same "A"/"B" ids for their
// `team` field. Each entry's `id` also keys server.js's KITS lookup, which
// maps it to that Character's Primary Ability (see projectiles.js's ranged
// Projectile and melee.js's melee swing) — the two kits share the same dash
// Secondary Ability (stepCharacter above) and the same generic
// cooldown/edge-trigger Primary Ability step (abilities.js's
// stepPrimaryAbility), differing only in cooldown length and fire effect.
export const TEAMS = ["A", "B"];
export const TEAM_COLORS = { A: 0xe8543e, B: 0x3ea1e8 };
export const CHARACTERS = [
  { id: "naut", name: "Naut" },
  { id: "brawler", name: "Brawler" },
];

function isGrounded(entity, tilemap) {
  const footY = entity.y + entity.height + 1;
  return (
    tilemap.isSolid(tilemap.getTileAtWorld(entity.x + 1, footY)) ||
    tilemap.isSolid(tilemap.getTileAtWorld(entity.x + entity.width - 1, footY))
  );
}

/**
 * Advance a Character one fixed step: run + gravity + edge-triggered jump +
 * dash (Secondary Ability) + tilemap collision. Called identically by the
 * server's authoritative `fixedUpdate` and the client's
 * prediction/reconciliation `simulate` — must stay a pure function of
 * (entity, input, dt, tilemap) so both sides agree.
 *
 * Uses `Entity.prototype.fixedUpdate` directly (not `entity.fixedUpdate()`)
 * so it integrates via the base accel→drag→clamp→position step regardless of
 * whether `entity` is a subclass that overrides `fixedUpdate` to call this.
 */
export function stepCharacter(entity, input, dt, tilemap) {
  // Last non-neutral horizontal input direction. Read by the Primary Ability
  // (projectiles.js's stepPrimaryAbility, called after this) and by dash
  // below — tracked once here rather than in both places.
  if (input.left) entity.facing = -1;
  else if (input.right) entity.facing = 1;

  if (entity.dashCooldown > 0) entity.dashCooldown -= dt;

  const dashRequested = !!input.dash && !entity._prevDash;
  entity._prevDash = !!input.dash;
  if (dashRequested && entity.dashTimer <= 0 && entity.dashCooldown <= 0) {
    entity.dashTimer = DASH_DURATION;
    entity.dashCooldown = DASH_COOLDOWN;
  }

  if (entity.dashTimer > 0) {
    entity.dashTimer -= dt;
    // Overrides normal run/gravity for the burst: zero drag/gravity and a
    // temporarily raised maxVelocity so the burst speed isn't immediately
    // clamped back down to MAX_VEL_X by Entity's own integration (accel ->
    // drag -> maxVelocity clamp -> position, see CLAUDE.md's engine summary).
    entity.acceleration.x = 0;
    entity.acceleration.y = 0;
    entity.drag.x = 0;
    entity.maxVelocity.x = DASH_SPEED;
    entity.velocity.set(entity.facing * DASH_SPEED, 0);
  } else {
    entity.drag.x = DRAG_X;
    entity.maxVelocity.x = MAX_VEL_X;
    entity.acceleration.x = 0;
    if (input.left) entity.acceleration.x -= RUN_ACCEL;
    if (input.right) entity.acceleration.x += RUN_ACCEL;
    entity.acceleration.y = GRAVITY;

    if (input.jump && !entity._prevJump && entity._grounded) {
      entity.velocity.y = -JUMP_VELOCITY;
    }
  }
  entity._prevJump = !!input.jump;

  Entity.prototype.fixedUpdate.call(entity, dt);

  tilemap.collide(entity);
  entity._grounded = isGrounded(entity, tilemap);
}
