import { describe, test, expect } from "vitest";
import { getMap } from "../maps.js";
import { TILE, TEAMS } from "../shared.js";
import {
  Minion,
  canEngage,
  resolveMinionCombat,
  laneWaypoints,
  MINION_H,
  MINION_HP,
  MINION_DAMAGE,
  MINION_ATTACK_INTERVAL,
  MINION_SPEED,
} from "../minions.js";

const [TEAM_A, TEAM_B] = TEAMS;

describe("laneWaypoints", () => {
  const lane = getMap("singleLane").lanes[0];

  test("Team A walks the Lane's points in order, feet resting on the floor tile", () => {
    const points = lane.points;
    expect(laneWaypoints(lane, TEAM_A)).toEqual(
      points.map((p) => ({ x: p.x * TILE, y: p.y * TILE - MINION_H })),
    );
  });

  test("Team B walks the same points in reverse", () => {
    const a = laneWaypoints(lane, TEAM_A);
    const b = laneWaypoints(lane, TEAM_B);
    expect(b).toEqual([...a].reverse());
  });
});

// `waypoints` passed to a Minion is the path AHEAD of its spawn point (the
// spawn point itself isn't a waypoint to walk to) — see server.js's
// MinionDirector._spawn, which slices it off `laneWaypoints`'s result.
describe("Minion movement", () => {
  test("advances toward the next waypoint each fixedUpdate", () => {
    const minion = new Minion(0, 0, TEAM_A, 0, [{ x: 1000, y: 0 }], 0xffffff);
    minion.fixedUpdate(1);
    expect(minion.x).toBeCloseTo(MINION_SPEED, 5);
    expect(minion.y).toBeCloseTo(0, 5);
    expect(minion.wpIndex).toBe(0);
  });

  test("snaps to a waypoint once within range and advances to the next one", () => {
    const waypoints = [{ x: 5, y: 0 }, { x: 5, y: 100 }];
    const minion = new Minion(0, 0, TEAM_A, 0, waypoints, 0xffffff);
    minion.fixedUpdate(1); // one big step covers the short first leg
    expect(minion.x).toBe(5);
    expect(minion.y).toBe(0);
    expect(minion.wpIndex).toBe(1);
  });

  test("idles once it runs out of waypoints (reached the enemy Base)", () => {
    const minion = new Minion(0, 0, TEAM_A, 0, [], 0xffffff);
    const { x, y } = minion;
    minion.fixedUpdate(1); // no waypoints at all — should not move or throw
    expect(minion.x).toBe(x);
    expect(minion.y).toBe(y);
  });

  test("engaged flag halts one tick of advance, then clears", () => {
    const minion = new Minion(0, 0, TEAM_A, 0, [{ x: 1000, y: 0 }], 0xffffff);
    minion.engaged = true;
    minion.fixedUpdate(1);
    expect(minion.x).toBe(0); // held in place while engaged
    expect(minion.engaged).toBe(false); // consumed for next tick
    minion.fixedUpdate(1);
    expect(minion.x).toBeGreaterThan(0); // resumes advancing
  });

  test("attack cooldown counts down toward zero, never negative-driven twice", () => {
    const minion = new Minion(0, 0, TEAM_A, 0, [], 0xffffff);
    minion.attackCooldown = MINION_ATTACK_INTERVAL;
    minion.fixedUpdate(MINION_ATTACK_INTERVAL / 2);
    expect(minion.attackCooldown).toBeCloseTo(MINION_ATTACK_INTERVAL / 2, 5);
  });
});

describe("canEngage", () => {
  function minion(team, laneIndex) {
    return new Minion(0, 0, team, laneIndex, [], 0xffffff);
  }

  test("opposing Teams on the same Lane can engage", () => {
    expect(canEngage(minion(TEAM_A, 0), minion(TEAM_B, 0))).toBe(true);
  });

  test("same Team never engages, even on the same Lane", () => {
    expect(canEngage(minion(TEAM_A, 0), minion(TEAM_A, 0))).toBe(false);
  });

  test("opposing Teams on different Lanes don't cross-engage (twinLanes overlap case)", () => {
    expect(canEngage(minion(TEAM_A, 0), minion(TEAM_B, 1))).toBe(false);
  });

  test("a Minion already dead this tick (0 hp, not yet despawned) can't engage", () => {
    const a = minion(TEAM_A, 0);
    const b = minion(TEAM_B, 0);
    b.hp = 0; // killed by an earlier pair in the same scene.overlap pass
    expect(canEngage(a, b)).toBe(false);
  });

  test("non-Minion entities never engage", () => {
    const notAMinion = { team: TEAM_A, laneIndex: 0, hp: 1 };
    expect(canEngage(notAMinion, minion(TEAM_B, 0))).toBe(false);
  });
});

describe("resolveMinionCombat", () => {
  function minion(team) {
    return new Minion(0, 0, team, 0, [], 0xffffff);
  }

  test("both attack when cooldowns are ready, damaging each other", () => {
    const a = minion(TEAM_A);
    const b = minion(TEAM_B);
    const result = resolveMinionCombat(a, b);
    expect(a.hp).toBe(MINION_HP - MINION_DAMAGE);
    expect(b.hp).toBe(MINION_HP - MINION_DAMAGE);
    expect(a.attackCooldown).toBe(MINION_ATTACK_INTERVAL);
    expect(b.attackCooldown).toBe(MINION_ATTACK_INTERVAL);
    expect(result).toEqual({ aDied: false, bDied: false });
  });

  test("marks both engaged regardless of cooldown", () => {
    const a = minion(TEAM_A);
    const b = minion(TEAM_B);
    a.attackCooldown = 5; // still on cooldown, shouldn't attack
    resolveMinionCombat(a, b);
    expect(a.engaged).toBe(true);
    expect(b.engaged).toBe(true);
    expect(b.hp).toBe(MINION_HP); // a didn't attack
    expect(a.hp).toBe(MINION_HP - MINION_DAMAGE); // b still did
  });

  test("reports death once hp drops to or below zero", () => {
    const a = minion(TEAM_A);
    const b = minion(TEAM_B);
    b.hp = MINION_DAMAGE; // exactly lethal from a's hit
    const result = resolveMinionCombat(a, b);
    expect(b.hp).toBeLessThanOrEqual(0);
    expect(result.bDied).toBe(true);
  });
});
