// structures.js — Tower and Base entities: server-authoritative HP and
// destruction gating a Lane's damage flow (see CONTEXT.md's Tower/Base
// glossary and #5's acceptance criteria). Position/size come from maps.js's
// Map data (see server.js's MinionDirector, which builds one Tower per Lane
// and one Base per map.bases entry); only HP/destruction state is simulated
// here. Like Minion, neither is predicted client-side, so this only needs to
// run in the server's authoritative fixedUpdate.
import { Entity } from "@cjgammon/gamekit";
import { Minion, MINION_DAMAGE, MINION_ATTACK_INTERVAL } from "./minions.js";

export const TOWER_HP = 300;
export const BASE_HP = 500;

/**
 * A Lane's checkpoint: must be destroyed before Minions/Characters can damage
 * anything further down that Lane, including the Base (see CONTEXT.md). It's
 * neutral rather than team-owned (see maps.js's TOWER_COLOR comment), so
 * either Team's Minions can damage it.
 */
export class Tower extends Entity {
  constructor(x, y, w, h, laneIndex) {
    super(x, y);
    this.width = w;
    this.height = h;
    this.laneIndex = laneIndex;
    this.hp = TOWER_HP;
  }
}

/**
 * A Team's home structure. Invulnerable while its Lane's Tower(s) still
 * stand — enforced by the caller (server.js's MinionDirector), which only
 * lets a Minion engage a Base once its own Lane's Tower is destroyed. Losing
 * its core ends the Match for that Team.
 */
export class Base extends Entity {
  constructor(x, y, w, h, team) {
    super(x, y);
    this.width = w;
    this.height = h;
    this.team = team;
    this.hp = BASE_HP;
  }

  // Per-entity payload the client reads via BaseView.applyNetState.
  netState() {
    return { team: this.team };
  }
}

/**
 * Horizontal-range overlap only. Tower/Base sit beside a Lane with their
 * bottom edge flush to the ground line (see maps.js and its
 * tests/maps.test.js), not literally under a Minion's walking height, so a
 * full 2D AABB test (as used for Minion-vs-Minion combat) never fires for
 * these pairs — gating instead checks a Minion's x range against the
 * structure's, ignoring y, matching a Lane's shape as a walked path rather
 * than an open arena.
 */
function xOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

/**
 * Whether a Minion can engage (and thus be gated by) its own Lane's Tower:
 * same Lane, both alive, and horizontally in range.
 */
export function canEngageTower(minion, tower) {
  return (
    minion instanceof Minion &&
    minion.hp > 0 &&
    tower.hp > 0 &&
    minion.laneIndex === tower.laneIndex &&
    xOverlap(minion, tower)
  );
}

/**
 * Whether an enemy Minion can engage a Base: opposing Team, both alive, and
 * horizontally in range. Callers must additionally confirm this Lane's Tower
 * is already destroyed — see server.js's MinionDirector, which only checks
 * this once a Minion's own Lane Tower's hp has reached 0.
 */
export function canEngageBase(minion, base) {
  return (
    minion instanceof Minion &&
    minion.hp > 0 &&
    base.hp > 0 &&
    minion.team !== base.team &&
    xOverlap(minion, base)
  );
}

/**
 * Resolve one tick of a Minion attacking a Tower or Base the caller has
 * already confirmed is eligible via canEngageTower/canEngageBase — same
 * cooldown/damage as Minion-vs-Minion combat (see minions.js's
 * resolveMinionCombat), just one-directional: structures don't fight back.
 * Sets `engaged` so the Minion halts its advance this tick (see minions.js's
 * Minion.fixedUpdate), which is what keeps it from walking through a live
 * Tower. Reports whether the structure died so the caller can despawn it
 * (Tower) or end the Match (Base).
 */
export function resolveStructureDamage(minion, structure) {
  minion.engaged = true;
  let destroyed = false;
  if (minion.attackCooldown <= 0) {
    structure.hp -= MINION_DAMAGE;
    minion.attackCooldown = MINION_ATTACK_INTERVAL;
    if (structure.hp <= 0) destroyed = true;
  }
  return { destroyed };
}
