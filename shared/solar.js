// solar.js — Solar: the currency Characters collect from defeated Minions
// (see minions.js) and spend at their own Team's Base on temporary per-Match
// Upgrades (see CONTEXT.md's Solar/Upgrade glossary — "does not persist
// beyond the Match"). Server-authoritative only, same as Minion/Tower/Base:
// a SolarPickup isn't predicted client-side (no player drives it, and
// collecting one has no latency-sensitive feedback that needs prediction),
// and Upgrade purchases resolve on the server the same way a Primary
// Ability fire does (see server.js's MinionDirector.tryPurchaseUpgrade).
import { Entity } from "@cjgammon/gamekit";
import { pickNetState, SOLAR_STATE } from "./protocol.js";

export const SOLAR_PICKUP_SIZE = 6;
export const SOLAR_PER_MINION = 5;
export const SOLAR_PER_CHARACTER = 20; // a Character kill is worth far more than one Minion

// One-time-per-Match Upgrades a Character can buy at their own Team's Base
// with accumulated Solar. Each key is both the id sent from the client
// (Character.input.buyUpgrade) and the flag recorded on
// `character.upgrades` once bought, so a Character can't buy the same
// Upgrade twice in one Match.
export const UPGRADES = {
  damage: { cost: 30, damageMultiplier: 1.5 },
  speed: { cost: 20, speedMultiplier: 1.3 },
};

/**
 * A pickup of collectible Solar, dropped at a defeated Minion's or
 * Character's death location — see server.js's MinionDirector.dropSolar.
 * Any Character walking over one collects it, regardless of Team (see
 * CONTEXT.md: Solar isn't described as Team-owned, unlike a Tower/Base).
 */
export class SolarPickup extends Entity {
  constructor(x, y, amount) {
    super(x, y);
    this.width = SOLAR_PICKUP_SIZE;
    this.height = SOLAR_PICKUP_SIZE;
    this.amount = amount;
    // Set the instant a Character's collection resolves this tick, before
    // the caller (server.js's MinionDirector) gets around to despawning
    // it — mirrors minions.js's canEngage hp>0 check: scene.overlap
    // snapshots its candidate list once per call, so a second Character
    // overlapping the same still-live pickup later in the same pass must
    // not also collect it.
    this.collected = false;
  }

  // Per-entity payload the client reads via SolarPickupView.applyNetState —
  // see protocol.js's SOLAR_STATE. Currently empty: SolarPickupView renders
  // a fixed gold tint and reads nothing dynamic, so `amount` (used only
  // server-side, to credit the collecting Character) isn't synced.
  netState() {
    return pickNetState(this, SOLAR_STATE);
  }
}

/** Whether `character` can collect `pickup`: alive and not already collected this tick. */
export function canCollect(character, pickup) {
  return character.hp > 0 && !pickup.collected;
}

/** Resolves a collection already confirmed via canCollect: credits the Character's Solar total and marks the pickup spent. */
export function resolveCollect(character, pickup) {
  character.solar += pickup.amount;
  pickup.collected = true;
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Whether `character` can purchase `upgradeId` at `base`: a real Upgrade id,
 * not already bought this Match, enough Solar, `base` is that Character's
 * own Team's Base (not the enemy's), and the Character is standing inside
 * it. Full AABB overlap (not structures.js's xOverlap horizontal-only test)
 * since buying an Upgrade should require actually being at the Base, not
 * just sharing its Lane's x range.
 */
export function canPurchaseUpgrade(character, base, upgradeId) {
  const upgrade = UPGRADES[upgradeId];
  if (!upgrade) return false;
  if (character.upgrades[upgradeId]) return false;
  if (character.solar < upgrade.cost) return false;
  if (base.team !== character.team) return false;
  return overlaps(character, base);
}

/**
 * Resolves a purchase already confirmed via canPurchaseUpgrade: deducts its
 * cost, marks it bought (so it can't be bought again this Match), and
 * applies its stat effect for the remainder of the current Match — never
 * persisted anywhere beyond `character`'s own in-memory state, so it
 * naturally disappears when the Match (and this Character instance) ends.
 */
export function resolvePurchaseUpgrade(character, upgradeId) {
  const upgrade = UPGRADES[upgradeId];
  character.solar -= upgrade.cost;
  character.upgrades[upgradeId] = true;
  if (upgrade.damageMultiplier !== undefined) character.damageMultiplier = upgrade.damageMultiplier;
  if (upgrade.speedMultiplier !== undefined) character.speedMultiplier = upgrade.speedMultiplier;
}
