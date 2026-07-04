// shared/melee.js — melee Character kit sizing/timing constants, imported
// by both the server (server/melee.js's hitbox/combat logic) and the client
// (client/match-view.js's melee flash cosmetic, sized/cooldown-gated the
// same as the real swing). The hitbox/damage logic itself lives in
// server/melee.js, not here, since it depends on server-only structures.js
// (Tower) for its canHitMelee check — same split as projectiles.js.
export const MELEE_RANGE = 12; // px the hitbox extends past the Character's leading edge
export const MELEE_HEIGHT_PAD = 4; // px the hitbox extends above/below the Character, for a forgiving swing arc
export const MELEE_DAMAGE = 12;
export const MELEE_COOLDOWN = 0.4; // seconds between swings — shorter than the ranged Primary Ability's, matching a melee kit's tighter reach
