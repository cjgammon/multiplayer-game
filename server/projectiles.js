// server/projectiles.js — the ranged Character's Primary Ability: fired in a
// straight line, damages enemy Minions, (neutral) Towers, and enemy
// Characters using the same HP/damage pattern as Minion combat (see
// minions.js/structures.js) — a Character reaching 0 hp here is downed by the
// caller (#9, see server.js's resolveProjectileHit and respawn.js), the same
// flow melee.js's swing already triggers. Not predicted client-side —
// CONTEXT.md only calls out the dash Secondary Ability for that — so like
// Minion, this only needs to run in the server's authoritative fixedUpdate.
// Its cooldown/edge-trigger bookkeeping comes from abilities.js's
// stepPrimaryAbility, the same generic step melee.js's melee swing uses —
// see that module for the melee kit's counterpart to this one.
//
// Split from shared/projectiles.js (which just holds sizing/timing
// constants both sides need): this half depends on structures.js's Tower for
// canHit's eligibility check, and Tower is server-only, so this file can't
// live in shared/ without shared/ reaching into server-only code.
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
import {
  PROJECTILE_W, PROJECTILE_H, PROJECTILE_SPEED,
  PROJECTILE_DAMAGE, PROJECTILE_COOLDOWN, PROJECTILE_LIFETIME,
} from "../shared/projectiles.js";
import { Minion } from "../shared/minions.js";
import { Tower } from "./structures.js";
import { pickNetState, PROJECTILE_STATE } from "../shared/protocol.js";

/**
 * A Character's Primary Ability projectile: travels in a straight line at
 * `facing`'s direction until it hits something or its lifetime runs out.
 * `director` is server.js's MinionDirector — `director.resolveProjectileHit(this)`
 * below does the actual scene sweep and target elimination; this module only
 * supplies the pure eligibility/damage math it calls (canHit/
 * applyProjectileDamage).
 */
export class Projectile extends Entity {
  constructor(x, y, team, facing, director, damageMultiplier = 1) {
    super(x, y);
    this.width = PROJECTILE_W;
    this.height = PROJECTILE_H;
    this.team = team;
    this.velocity.set(facing * PROJECTILE_SPEED, 0);
    this.life = PROJECTILE_LIFETIME;
    this.director = director;
    // Captured from the firing Character at spawn time (see server.js's
    // KITS.fire) — a damage Upgrade bought after this Projectile is already
    // in flight shouldn't retroactively change it, matching how melee.js's
    // applyMeleeDamage reads the attacker's multiplier live at swing time
    // (a swing resolves instantly, so "live" and "at spawn time" coincide
    // there; a Projectile's flight is the one place the distinction matters).
    this.damageMultiplier = damageMultiplier;
    // Set once a hit is resolved — marks it for despawn next sweep without
    // mutating `life` (which only tracks lifetime expiry).
    this.spent = false;
  }

  fixedUpdate(dt) {
    super.fixedUpdate(dt); // integrate velocity -> position
    this.life -= dt;
    if (!this.spent) this.director.resolveProjectileHit(this);
  }

  // Per-entity payload the client reads via ProjectileView.applyNetState —
  // see protocol.js's PROJECTILE_STATE for the field list.
  netState() {
    return pickNetState(this, PROJECTILE_STATE);
  }
}

/**
 * Whether a live Projectile can hit `target`: an enemy Minion, any (neutral)
 * Tower still standing — Towers aren't Team-owned (see structures.js's
 * TOWER_COLOR comment), so any Team's projectile can damage one, matching how
 * any Team's Minion already can via canEngageTower — or an enemy Character.
 * Characters aren't a class this module can import without a cycle back to
 * server.js (which defines it), so one is identified structurally by its
 * `character` field, same as melee.js's canHitMelee does.
 */
export function canHit(projectile, target) {
  if (target.hp <= 0) return false;
  if (target instanceof Minion) return target.team !== projectile.team;
  if (target instanceof Tower) return true;
  if (target.character !== undefined) return target.team !== projectile.team;
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
  target.hp -= PROJECTILE_DAMAGE * (projectile.damageMultiplier ?? 1);
  return { destroyed: target.hp <= 0 };
}
