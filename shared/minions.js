// minions.js — the Minion entity and its combat resolution. Pure server-side:
// unlike Character movement (shared.js's stepCharacter), no client predicts a
// Minion since no player drives it, so its stepping logic only needs to run
// in the server's authoritative fixedUpdate (see server.js's MinionDirector).
import { Entity } from "@cjgammon/gamekit";
import { TILE, TEAMS } from "./shared.js";
import { pickNetState, MINION_STATE } from "./protocol.js";

export const MINION_W = 10;
export const MINION_H = 10;
export const MINION_SPEED = 40; // px/s along its Lane
export const MINION_HP = 30;
export const MINION_DAMAGE = 5;
export const MINION_ATTACK_INTERVAL = 0.6; // seconds between hits
export const MINION_SPAWN_INTERVAL = 6; // seconds between waves, per Lane per Team

/**
 * Convert a Lane's tile-coordinate path (see maps.js) into the pixel-space
 * waypoints one Team's Minions walk, ordered from that Team's Base toward the
 * enemy's. `lane.points` runs Team A's Base -> Team B's Base, so Team B's
 * Minions walk the same points in reverse. `p.y * TILE` is the floor tile's
 * *top* edge — offset by MINION_H so a Minion's feet (not its top-left
 * corner) rest on the floor, the same convention maps.js's `base`/`tower`
 * helpers use for their own y (e.g. `15 * TILE - BASE_SIZE`).
 */
export function laneWaypoints(lane, team) {
  const points = lane.points.map((p) => ({
    x: p.x * TILE,
    y: p.y * TILE - MINION_H,
  }));
  return team === TEAMS[0] ? points : points.slice().reverse();
}

/**
 * An AI-controlled unit that walks its Lane's waypoints toward the enemy
 * Base, fighting same-Lane enemy Minions in its path (see CONTEXT.md's Minion
 * glossary). Combat is resolved by the caller (server.js's MinionDirector,
 * driving `scene.overlap` once per tick) via `resolveMinionCombat` below —
 * this class only owns movement and the state that combat mutates.
 */
export class Minion extends Entity {
  constructor(x, y, team, laneIndex, waypoints, color) {
    super(x, y);
    this.width = MINION_W;
    this.height = MINION_H;
    this.team = team;
    this.laneIndex = laneIndex;
    this.waypoints = waypoints;
    this.wpIndex = 0;
    this.hp = MINION_HP;
    this.color = color;
    this.attackCooldown = 0;
    // Set by the Director for each tick a same-Lane enemy overlaps this
    // Minion — halts that tick's advance so the two lines stand and trade
    // hits instead of walking through each other.
    this.engaged = false;
  }

  fixedUpdate(dt) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.engaged) {
      this.engaged = false;
      return;
    }
    this._advance(dt);
  }

  _advance(dt) {
    const target = this.waypoints[this.wpIndex];
    if (!target) return; // reached the end of the Lane — idle at the enemy Base
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);
    const step = MINION_SPEED * dt;
    if (dist <= step) {
      this.x = target.x;
      this.y = target.y;
      this.wpIndex++;
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
  }

  // Per-entity payload the client reads via MinionView.applyNetState — see
  // protocol.js's MINION_STATE for the field list.
  netState() {
    return pickNetState(this, MINION_STATE);
  }
}

/**
 * Whether two overlapping entities should fight: both Minions, same Lane,
 * opposing Teams, and both still alive this tick. The `hp > 0` check matters
 * because `scene.overlap` snapshots its candidate list once per call — if a
 * third same-Lane Minion overlaps a pair whose fight already killed one side
 * earlier in the same pass, the dead one hasn't been despawned yet and would
 * otherwise still land a hit (see MinionDirector._resolveCombat in
 * server.js, which calls this before resolveMinionCombat).
 */
export function canEngage(a, b) {
  return (
    a instanceof Minion &&
    b instanceof Minion &&
    a.hp > 0 &&
    b.hp > 0 &&
    a.team !== b.team &&
    a.laneIndex === b.laneIndex
  );
}

/**
 * Resolve one tick of combat between two Minions the caller has already
 * confirmed are eligible via `canEngage` (see server.js's
 * MinionDirector._resolveCombat, which owns that filtering so this stays a
 * pure, easily-tested function). Each attacks if its cooldown has elapsed,
 * marks both `engaged`, and reports which (if either) died so the caller can
 * despawn them via `net.despawn`.
 */
export function resolveMinionCombat(a, b) {
  a.engaged = true;
  b.engaged = true;
  let aDied = false;
  let bDied = false;
  if (a.attackCooldown <= 0) {
    b.hp -= MINION_DAMAGE;
    a.attackCooldown = MINION_ATTACK_INTERVAL;
    if (b.hp <= 0) bDied = true;
  }
  if (b.attackCooldown <= 0) {
    a.hp -= MINION_DAMAGE;
    b.attackCooldown = MINION_ATTACK_INTERVAL;
    if (a.hp <= 0) aDied = true;
  }
  return { aDied, bDied };
}
