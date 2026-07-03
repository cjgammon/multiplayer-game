// projectiles.js — a Character's Primary Ability projectile: fired in a
// straight line, damages enemy Minions and (neutral) Towers using the same
// HP/damage pattern as Minion combat (see minions.js/structures.js). Not
// predicted client-side — CONTEXT.md only calls out the dash Secondary
// Ability for that — so like Minion, this only needs to run in the server's
// authoritative fixedUpdate.
//
// Unlike Minion (which moves itself but leaves combat resolution to a
// director-run pass over the whole scene — see server.js's MinionDirector),
// a Projectile resolves its own hit test at the end of its own fixedUpdate,
// the same self-contained shape as gamekit's pong example's Ball(game). That
// split matters here: MinionDirector's own fixedUpdate runs *before* a
// Projectile's in the same tick's scene sweep (Directors are added to the
// scene ahead of any net.spawn'd entity — see server.js), so a
// director-driven check would always test the Projectile's *pre-move*
// position for this tick — using gamekit's Scene.overlapSwept (see
// server.js's MinionDirector.resolveProjectileHit) from there would just
// collapse to a zero-width sweep and let a fast Projectile tunnel through a
// target it never actually got tested against mid-flight. Checking
// immediately after its own motion integrates sidesteps that ordering
// entirely.
import { Entity } from "@cjgammon/gamekit";
import { Minion } from "./minions.js";
import { Tower } from "./structures.js";

export const PROJECTILE_W = 6;
export const PROJECTILE_H = 6;
export const PROJECTILE_SPEED = 260; // px/s
export const PROJECTILE_DAMAGE = 8;
export const PROJECTILE_COOLDOWN = 0.5; // seconds between shots
export const PROJECTILE_LIFETIME = 1.2; // seconds before despawning unspent

/**
 * A Character's Primary Ability projectile: travels in a straight line at
 * `facing`'s direction until it hits something or its lifetime runs out.
 * `director` is server.js's MinionDirector — `director.resolveProjectileHit(this)`
 * below does the actual scene sweep and target elimination; this module only
 * supplies the pure eligibility/damage math it calls (canHit/
 * applyProjectileDamage).
 */
export class Projectile extends Entity {
  constructor(x, y, team, facing, director) {
    super(x, y);
    this.width = PROJECTILE_W;
    this.height = PROJECTILE_H;
    this.team = team;
    this.velocity.set(facing * PROJECTILE_SPEED, 0);
    this.life = PROJECTILE_LIFETIME;
    this.director = director;
    // Set once a hit is resolved — marks it for despawn next sweep without
    // mutating `life` (which only tracks lifetime expiry).
    this.spent = false;
  }

  fixedUpdate(dt) {
    super.fixedUpdate(dt); // integrate velocity -> position
    this.life -= dt;
    if (!this.spent) this.director.resolveProjectileHit(this);
  }

  // Per-entity payload the client reads via ProjectileView.applyNetState.
  netState() {
    return { team: this.team };
  }
}

/**
 * Advance a Character's Primary Ability state one fixed step: cooldown
 * countdown and an edge-triggered fire request exactly like shared.js's
 * stepCharacter jump handling — holding the fire key doesn't spam-fire, only
 * the moment it's pressed does, and even then only once `primaryCooldown` has
 * elapsed. Fires in `character.facing`'s direction — tracked by
 * stepCharacter (called first each tick, see server.js's Character.fixedUpdate)
 * since dash needs that same facing state. Returns whether to spawn a
 * projectile this tick; the caller (server.js's Character.fixedUpdate) does
 * the actual spawning since that needs the net layer, not this pure function.
 */
export function stepPrimaryAbility(character, input, dt) {
  if (character.primaryCooldown > 0) character.primaryCooldown -= dt;

  const requesting = !!input.fire && !character._prevFire;
  character._prevFire = !!input.fire;

  if (requesting && character.primaryCooldown <= 0) {
    character.primaryCooldown = PROJECTILE_COOLDOWN;
    return true;
  }
  return false;
}

/**
 * Whether a live Projectile can hit `target`: an enemy Minion, or any
 * (neutral) Tower still standing — Towers aren't Team-owned (see
 * structures.js's TOWER_COLOR comment), so any Team's projectile can damage
 * one, matching how any Team's Minion already can via canEngageTower.
 */
export function canHit(projectile, target) {
  if (target.hp <= 0) return false;
  if (target instanceof Minion) return target.team !== projectile.team;
  if (target instanceof Tower) return true;
  return false;
}

/**
 * Resolve a Projectile hitting an eligible target (already confirmed via
 * canHit by the caller): damages the target for PROJECTILE_DAMAGE and
 * reports whether it died. One-directional and single-use, like
 * resolveStructureDamage — the Projectile is always spent on a hit, which the
 * caller marks via `projectile.spent = true`.
 */
export function applyProjectileDamage(projectile, target) {
  target.hp -= PROJECTILE_DAMAGE;
  return { destroyed: target.hp <= 0 };
}
