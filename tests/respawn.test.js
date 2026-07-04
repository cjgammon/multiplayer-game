import { describe, test, expect } from "vitest";
import { Entity } from "@cjgammon/gamekit";
import { TEAMS, CHAR_W, CHAR_H, CHAR_HP, SPAWN_Y } from "../shared.js";
import { Base } from "../structures.js";
import { RESPAWN_TIME, downCharacter, respawnPoint, teamSpawnPoint, stepRespawn } from "../respawn.js";

const [TEAM_A] = TEAMS;

function character(x = 0, y = 0) {
  const c = new Entity(x, y);
  c.width = CHAR_W;
  c.height = CHAR_H;
  c.team = TEAM_A;
  c.character = "naut";
  c.hp = CHAR_HP;
  c.downed = false;
  c.respawnTimer = 0;
  return c;
}

describe("downCharacter", () => {
  test("zeroes hp and starts the respawn timer", () => {
    const c = character();
    c.hp = -4; // an overkill melee hit can leave hp negative
    downCharacter(c);
    expect(c.hp).toBe(0);
    expect(c.downed).toBe(true);
    expect(c.respawnTimer).toBe(RESPAWN_TIME);
  });
});

describe("respawnPoint", () => {
  test("centers horizontally on the Base, at SPAWN_Y", () => {
    const base = new Base(100, 200, 48, 48, TEAM_A);
    const point = respawnPoint(base, CHAR_W);
    expect(point.x).toBe(100 + 24 - CHAR_W / 2);
    expect(point.y).toBe(SPAWN_Y);
  });

});

describe("teamSpawnPoint", () => {
  // #11: a solo Team (teamSize 1) must match earlier 1-2 player Matches'
  // single-point spawn exactly.
  test("collapses to respawnPoint's center for a solo Team", () => {
    const base = new Base(100, 200, 48, 48, TEAM_A);
    expect(teamSpawnPoint(base, CHAR_W, 0, 1)).toEqual(respawnPoint(base, CHAR_W));
  });

  test("spreads a full 3-player Team evenly, centered on the Base, in join order", () => {
    const base = new Base(100, 200, 48, 48, TEAM_A);
    const first = teamSpawnPoint(base, CHAR_W, 0, 3);
    const second = teamSpawnPoint(base, CHAR_W, 1, 3);
    const third = teamSpawnPoint(base, CHAR_W, 2, 3);
    expect(second.x).toBe(respawnPoint(base, CHAR_W).x); // the middle slot is dead-center
    expect(first.x).toBeLessThan(second.x);
    expect(third.x).toBeGreaterThan(second.x);
    expect(first.y).toBe(SPAWN_Y);
    expect(third.y).toBe(SPAWN_Y);
  });

  // Every slot must stay within the Base's own footprint so a full Team
  // doesn't spawn overlapping a Map's boundary wall (see maps.js's
  // buildMapData — walls sit right outside the outermost Bases).
  test("keeps every slot within the Base's own width", () => {
    const base = new Base(100, 200, 48, 48, TEAM_A);
    for (let i = 0; i < 3; i++) {
      const point = teamSpawnPoint(base, CHAR_W, i, 3);
      expect(point.x).toBeGreaterThanOrEqual(base.x);
      expect(point.x + CHAR_W).toBeLessThanOrEqual(base.x + base.width);
    }
  });
});

describe("stepRespawn", () => {
  test("counts down without reviving while time remains", () => {
    const c = character(500, 500);
    const base = new Base(0, 0, 48, 48, TEAM_A);
    downCharacter(c);
    const revived = stepRespawn(c, 1, base);
    expect(revived).toBe(false);
    expect(c.respawnTimer).toBeCloseTo(RESPAWN_TIME - 1, 5);
    expect(c.downed).toBe(true);
    expect(c.hp).toBe(0);
    // Still parked at the death position — hasn't teleported yet.
    expect(c.x).toBe(500);
  });

  test("revives at the Base once the timer elapses: healed, controllable, teleported", () => {
    const c = character(500, 500);
    c.velocity.set(40, -20);
    const base = new Base(0, 0, 48, 48, TEAM_A);
    downCharacter(c);
    const revived = stepRespawn(c, RESPAWN_TIME, base);
    expect(revived).toBe(true);
    expect(c.downed).toBe(false);
    expect(c.hp).toBe(CHAR_HP);
    expect(c.respawnTimer).toBe(0);
    expect(c.x).toBe(base.x + base.width / 2 - CHAR_W / 2);
    expect(c.y).toBe(SPAWN_Y);
    expect(c.velocity.x).toBe(0);
    expect(c.velocity.y).toBe(0);
  });

  test("revives exactly on the tick the timer crosses zero, not one tick late", () => {
    const c = character();
    const base = new Base(0, 0, 48, 48, TEAM_A);
    downCharacter(c);
    // Two steps that exactly sum to RESPAWN_TIME.
    expect(stepRespawn(c, RESPAWN_TIME - 0.5, base)).toBe(false);
    expect(stepRespawn(c, 0.5, base)).toBe(true);
  });
});
