// abilities.js — the Primary Ability abstraction shared by every Character
// kit: cooldown countdown + edge-triggered fire request, identical whether
// the kit's effect is a traveling Projectile (projectiles.js) or an
// instantaneous melee swing (melee.js). Kits differ only in cooldown length
// and what happens on trigger, so that's all a kit supplies — this stays a
// pure function of (character, input, dt, cooldown) so both the ranged and
// melee Character share it rather than each re-implementing the same
// edge-trigger/cooldown bookkeeping (see #8).
export function stepPrimaryAbility(character, input, dt, cooldown) {
  if (character.primaryCooldown > 0) character.primaryCooldown -= dt;

  const requesting = !!input.fire && !character._prevFire;
  character._prevFire = !!input.fire;

  if (requesting && character.primaryCooldown <= 0) {
    character.primaryCooldown = cooldown;
    return true;
  }
  return false;
}
