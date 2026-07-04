// melee.js — the melee Character's Primary Ability: unlike the ranged kit's
// traveling Projectile (projectiles.js), a swing is resolved instantly
// against a short hitbox extending from the Character's leading edge the
// moment it triggers — no separate net-synced entity or lifetime bookkeeping
// needed. Its cooldown/edge-trigger bookkeeping comes from abilities.js's
// stepPrimaryAbility, the same generic step the ranged kit's Primary Ability
// uses (see #8) — this module only supplies the melee-specific hitbox and
// damage math, called by server.js's MinionDirector.resolveMeleeSwing.
// Not predicted client-side, same as the ranged Projectile — only the dash/
// charge Secondary Ability is (see shared.js's stepCharacter) — so this only
// needs to run in the server's authoritative fixedUpdate.
//
// Damages enemy Minions, (neutral) Towers, and enemy Characters — the first
// Ability in this app to reach Characters at all (projectiles.js's canHit
// deliberately doesn't; see its header comment), matching #8's acceptance
// criteria. A Character reaching 0 hp here is downed by the caller (#9, see
// server.js's MinionDirector.resolveMeleeSwing and respawn.js) — this module
// only applies the damage and reports the death, not the respawn response.
import { Entity } from "@cjgammon/gamekit";
import { Minion } from "./minions.js";
import { Tower } from "./structures.js";

export const MELEE_RANGE = 12; // px the hitbox extends past the Character's leading edge
export const MELEE_HEIGHT_PAD = 4; // px the hitbox extends above/below the Character, for a forgiving swing arc
export const MELEE_DAMAGE = 12;
export const MELEE_COOLDOWN = 0.4; // seconds between swings — shorter than the ranged Primary Ability's, matching a melee kit's tighter reach

/**
 * The transient AABB one melee swing tests against: a box extending
 * MELEE_RANGE past `character`'s leading edge, in whichever direction it's
 * facing, padded vertically so a swing forgives being slightly mis-timed on
 * Y. Built fresh per swing (not net-synced) and handed straight to
 * `scene.overlap`, the same "plain Entity as a hit-test box" shape
 * projectiles.js's Projectile itself uses for `scene.overlapSwept`.
 */
export function meleeHitbox(character) {
  const hitbox = new Entity(
    character.facing > 0 ? character.x + character.width : character.x - MELEE_RANGE,
    character.y - MELEE_HEIGHT_PAD,
  );
  hitbox.width = MELEE_RANGE;
  hitbox.height = character.height + MELEE_HEIGHT_PAD * 2;
  return hitbox;
}

/**
 * Whether a melee swing from `attacker` (the swinging Character) can hit
 * `target`: an enemy Minion, any (neutral) Tower still standing, or an enemy
 * Character — mirrors projectiles.js's canHit, extended to Characters.
 * Characters aren't a class this module can import without a cycle back to
 * server.js (which defines it), so an enemy Character is identified by its
 * `character` field (the picked kit id, set only on Character instances —
 * see server.js's netState) rather than `instanceof`.
 */
export function canHitMelee(attacker, target) {
  if (target === attacker) return false;
  if (target.hp === undefined || target.hp <= 0) return false;
  if (target instanceof Minion) return target.team !== attacker.team;
  if (target instanceof Tower) return true;
  if (target.character !== undefined) return target.team !== attacker.team;
  return false;
}

/**
 * Resolve a melee swing hitting an eligible target (already confirmed via
 * canHitMelee by the caller): damages the target for MELEE_DAMAGE (scaled by
 * `attacker`'s damage Upgrade, if bought — see solar.js's UPGRADES) and
 * reports whether it died. Unlike a Projectile, a swing isn't "spent" on a
 * hit — the caller's `scene.overlap` naturally lets one swing damage
 * everything overlapping its hitbox, a short-range cleave rather than a
 * single-target shot.
 */
export function applyMeleeDamage(attacker, target) {
  target.hp -= MELEE_DAMAGE * (attacker.damageMultiplier ?? 1);
  return { destroyed: target.hp <= 0 };
}
