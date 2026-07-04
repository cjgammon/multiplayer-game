// combat.js — per-tick orchestration for combat resolution that involves
// more than one entity type: Minion-vs-structure gating, Projectile hit
// dispatch, and melee swing dispatch. Deliberately doesn't cover
// Minion-vs-Minion combat (server.js's MinionDirector calls minions.js's
// canEngage/resolveMinionCombat directly — there's no orchestration there
// worth naming, just a two-line dispatch), nor Solar collection/Upgrade
// purchases (economy, not combat — see solar.js, called directly by
// MinionDirector).
//
// Nothing here touches gamekit's `scene` or `net` — server.js's
// MinionDirector owns overlap/overlapSwept detection and applies the
// instructions returned below via `net`/`dropSolar`/`downCharacter`. That
// split keeps this module testable with plain Minion/Tower/Projectile/
// Character-shaped objects, no ServerGame or Scene required.
import { Minion } from "../shared/minions.js";
import { canEngageTower, canEngageBase, resolveStructureDamage } from "./structures.js";
import { Tower } from "./structures.js";
import { canHit, applyProjectileDamage } from "./projectiles.js";
import { canHitMelee, applyMeleeDamage } from "./melee.js";

/**
 * Resolve one tick of Minion-vs-Tower/Base combat across every live Minion.
 * Same gating this always had: a Minion can only reach its own Lane's Base
 * once that Lane's Tower is destroyed (the `tower.hp > 0` check below), and a
 * Minion already engaging its Tower never reaches the Base check at all (the
 * `continue`). Returns the events the caller needs to act on — despawning a
 * destroyed Tower, ending the Match on a destroyed Base — since a single tick
 * can produce more than one of these across different Lanes.
 */
export function resolveStructureCombat(minions, towers, bases) {
  const events = [];
  for (const minion of minions) {
    if (minion.hp <= 0) continue;
    const tower = towers[minion.laneIndex];
    if (canEngageTower(minion, tower)) {
      const { destroyed } = resolveStructureDamage(minion, tower);
      if (destroyed) events.push({ type: "towerDestroyed", tower });
      continue;
    }
    if (tower.hp > 0) continue;
    for (const base of bases) {
      if (!canEngageBase(minion, base)) continue;
      const { destroyed } = resolveStructureDamage(minion, base);
      if (destroyed) events.push({ type: "baseDestroyed", base });
    }
  }
  return events;
}

// A destroyed target needs a different despawn response depending on what it
// was: a Minion goes through MinionDirector's own tracked-list bookkeeping
// (_killMinion), a Tower straight through `net.despawn`, and a Character is
// downed (not despawned at all — see respawn.js) and drops Solar. Both
// resolveProjectileHit and resolveMeleeHit below classify their target the
// same way so the caller (server.js) applies one consistent dispatch.
function targetKindOf(target) {
  if (target instanceof Minion) return "minion";
  if (target instanceof Tower) return "tower";
  return "character"; // canHit/canHitMelee only ever admit these three kinds
}

/**
 * Resolve a single Projectile-vs-target hit candidate (the caller has
 * already found `target` via Scene.overlapSwept — see server.js's
 * MinionDirector.resolveProjectileHit — and hands it here one at a time,
 * same as that swept callback did). Reports whether the hit landed, whether
 * the target died, and (if it died) what kind of target it was, so the
 * caller knows which despawn/down response to apply.
 */
export function resolveProjectileHit(projectile, target) {
  if (projectile.spent || !canHit(projectile, target)) {
    return { hit: false, destroyed: false, targetKind: null };
  }
  const { destroyed } = applyProjectileDamage(projectile, target);
  projectile.spent = true;
  return { hit: true, destroyed, targetKind: targetKindOf(target) };
}

/**
 * Resolve a melee swing hitting a single candidate target (the caller has
 * already found `target` via Scene.overlap against melee.js's meleeHitbox —
 * see server.js's MinionDirector.resolveMeleeSwing — and hands it here one
 * at a time, same shape as resolveProjectileHit above, just without a
 * "spent" concept since one swing can cleave multiple targets).
 */
export function resolveMeleeHit(attacker, target) {
  if (!canHitMelee(attacker, target)) {
    return { hit: false, destroyed: false, targetKind: null };
  }
  const { destroyed } = applyMeleeDamage(attacker, target);
  return { hit: true, destroyed, targetKind: targetKindOf(target) };
}
