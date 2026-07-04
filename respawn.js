// respawn.js — timed respawn at a Character's own Team's Base on death (#9).
// A Character reaching 0 hp (currently only via melee.js's swing — the first
// Ability to reach Characters at all, per #8) is downed rather than
// destroyed: no elimination/lives model (see CONTEXT.md) — it just sits out
// of play for RESPAWN_TIME, then reappears at its own Team's Base fully
// healed. Pure functions here are called by server.js's MinionDirector
// (downCharacter, on a lethal melee hit) and Character (stepRespawn, from its
// own fixedUpdate), matching melee.js/structures.js's shape so both stay
// unit-testable against plain object/Base stand-ins rather than the
// un-exported Character class.
import { SPAWN_Y, CHAR_HP } from "./shared.js";

export const RESPAWN_TIME = 3; // seconds a downed Character waits before respawning

/**
 * Enter the downed state on a lethal hit. Left generic (no damage-source
 * param) so any future Ability that can kill a Character reuses this same
 * entry point rather than each caller reimplementing the state reset.
 */
export function downCharacter(character) {
  character.hp = 0;
  character.downed = true;
  character.respawnTimer = RESPAWN_TIME;
}

/**
 * Where a Team's Character reappears: horizontally centered on its own
 * Team's Base, at the same SPAWN_Y the initial connect spawn uses (see
 * server.js's createPlayer, via teamSpawnPoint below) so it falls onto the
 * Lane floor the same way — Base is a positioned Entity (structures.js) but
 * isn't part of the Tilemap's solid collision itself. Only used for a single
 * downed Character reviving alone, so it always lands dead-center — a Team
 * spawning several Characters at once uses teamSpawnPoint instead.
 */
export function respawnPoint(base, charWidth) {
  return { x: base.x + base.width / 2 - charWidth / 2, y: SPAWN_Y };
}

/**
 * Where one of several Characters connecting to the same Team at once
 * spawns (#11's up-to-3-per-Team lobby): spread evenly across the Team's own
 * Base's width, centered as a group — unlike respawnPoint's single fixed
 * point, so up to `teamSize` same-Team Characters don't render exactly
 * stacked on each other at Match start. `indexOnTeam`/`teamSize` are this
 * Character's position among, and count of, its own Team's players (see
 * server.js's createPlayer). A solo Team (teamSize 1, matching earlier
 * 1-2 player Matches) collapses to the same center point respawnPoint
 * returns.
 */
export function teamSpawnPoint(base, charWidth, indexOnTeam, teamSize) {
  const slotWidth = base.width / teamSize;
  const offset = (indexOnTeam - (teamSize - 1) / 2) * slotWidth;
  return { x: base.x + base.width / 2 - charWidth / 2 + offset, y: SPAWN_Y };
}

/**
 * Advance one downed Character's respawn countdown by `dt`. Returns whether
 * it respawned this tick, so the caller (server.js's Character.fixedUpdate)
 * knows to skip normal input handling for the same tick it revives on.
 * `base` is the Character's own Team's Base (caller looks it up — see
 * server.js's MinionDirector.bases). Uses `setPosition` (not raw x=/y=) so
 * the teleport doesn't smear the render-interpolation trail (see gamekit's
 * Entity.setPosition doc comment).
 */
export function stepRespawn(character, dt, base) {
  character.respawnTimer -= dt;
  if (character.respawnTimer > 0) return false;
  const point = respawnPoint(base, character.width);
  character.setPosition(point.x, point.y);
  character.velocity.set(0, 0);
  character.acceleration.set(0, 0);
  character.hp = CHAR_HP;
  character.downed = false;
  character.respawnTimer = 0;
  return true;
}
