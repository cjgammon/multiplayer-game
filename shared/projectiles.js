// shared/projectiles.js — Projectile sizing/timing constants, imported by
// both the server (server/projectiles.js's Projectile class/combat logic)
// and the client (client/match-view.js's ProjectileView, for sizing). The
// Projectile class itself lives in server/projectiles.js, not here, since it
// depends on server-only structures.js (Tower) for its canHit check — see
// that file's comment for why the two aren't the same module despite
// sharing a name.
export const PROJECTILE_W = 6;
export const PROJECTILE_H = 6;
export const PROJECTILE_SPEED = 260; // px/s
export const PROJECTILE_DAMAGE = 8;
export const PROJECTILE_COOLDOWN = 0.5; // seconds between shots
export const PROJECTILE_LIFETIME = 1.2; // seconds before despawning unspent
