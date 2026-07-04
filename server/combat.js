// combat.js — per-tick orchestration for combat resolution that involves
// more than one entity type: Minion-vs-structure gating and Projectile hit
// dispatch. Deliberately doesn't cover Minion-vs-Minion combat (server.js's
// MinionDirector calls minions.js's canEngage/resolveMinionCombat directly —
// there's no orchestration there worth naming, just a two-line dispatch).
//
// Neither function here touches gamekit's `scene` or `net` — server.js's
// MinionDirector owns overlap/overlapSwept detection and applies the
// instructions returned below via `net`. That split keeps this module
// testable with plain Minion/Tower/Base/Projectile-shaped objects, no
// ServerGame or Scene required.
import { Minion } from "../shared/minions.js";
import { canEngageTower, canEngageBase, resolveStructureDamage } from "./structures.js";
import { canHit, applyProjectileDamage } from "./projectiles.js";

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

/**
 * Resolve a single Projectile-vs-target hit candidate (the caller has
 * already found `target` via Scene.overlapSwept — see server.js's
 * MinionDirector.resolveProjectileHit — and hands it here one at a time,
 * same as that swept callback did). Reports whether the hit landed, whether
 * the target died, and whether that target was a Minion — the caller needs
 * that last flag because a dead Minion is despawned via MinionDirector's own
 * tracked-list bookkeeping (_killMinion), while every other despawn just goes
 * straight through `net.despawn`.
 */
export function resolveProjectileHit(projectile, target) {
  if (projectile.spent || !canHit(projectile, target)) {
    return { hit: false, destroyed: false, isMinion: false };
  }
  const { destroyed } = applyProjectileDamage(projectile, target);
  projectile.spent = true;
  return { hit: true, destroyed, isMinion: target instanceof Minion };
}
