import { describe, test, expect } from "vitest";
import { TEAMS } from "../shared.js";
import { Minion, MINION_HP, MINION_DAMAGE, MINION_ATTACK_INTERVAL } from "../minions.js";

const [TEAM_A, TEAM_B] = TEAMS;
import {
  Tower,
  Base,
  TOWER_HP,
  BASE_HP,
  canEngageTower,
  canEngageBase,
  resolveStructureDamage,
} from "../structures.js";

function minion(team, laneIndex, x = 0) {
  return new Minion(x, 0, team, laneIndex, [], 0xffffff);
}

describe("canEngageTower", () => {
  test("a Minion horizontally in range of its own Lane's Tower can engage it", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    expect(canEngageTower(minion(TEAM_A, 0, 10), tower)).toBe(true);
  });

  test("a Minion on a different Lane can't engage another Lane's Tower", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    expect(canEngageTower(minion(TEAM_A, 1, 10), tower)).toBe(false);
  });

  test("a Minion outside the Tower's horizontal range can't engage it", () => {
    const tower = new Tower(1000, 100, 32, 32, 0);
    expect(canEngageTower(minion(TEAM_A, 0, 10), tower)).toBe(false);
  });

  test("a destroyed Tower (hp <= 0) can no longer be engaged", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    tower.hp = 0;
    expect(canEngageTower(minion(TEAM_A, 0, 10), tower)).toBe(false);
  });

  test("a dead Minion can't engage a Tower", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    const m = minion(TEAM_A, 0, 10);
    m.hp = 0;
    expect(canEngageTower(m, tower)).toBe(false);
  });

  test("non-Minion entities never engage a Tower", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    expect(canEngageTower({ laneIndex: 0, hp: 1, x: 10, width: 10 }, tower)).toBe(false);
  });

  test("both Teams' Minions can engage the same neutral Tower", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    expect(canEngageTower(minion(TEAM_A, 0, 10), tower)).toBe(true);
    expect(canEngageTower(minion(TEAM_B, 0, 10), tower)).toBe(true);
  });
});

describe("canEngageBase", () => {
  test("an enemy Minion horizontally in range can engage a Base", () => {
    const base = new Base(0, 100, 48, 48, TEAM_B);
    expect(canEngageBase(minion(TEAM_A, 0, 10), base)).toBe(true);
  });

  test("a Minion can't engage its own Team's Base", () => {
    const base = new Base(0, 100, 48, 48, TEAM_A);
    expect(canEngageBase(minion(TEAM_A, 0, 10), base)).toBe(false);
  });

  test("a Minion outside the Base's horizontal range can't engage it", () => {
    const base = new Base(1000, 100, 48, 48, TEAM_B);
    expect(canEngageBase(minion(TEAM_A, 0, 10), base)).toBe(false);
  });

  test("a destroyed Base (hp <= 0) can no longer be engaged", () => {
    const base = new Base(0, 100, 48, 48, TEAM_B);
    base.hp = 0;
    expect(canEngageBase(minion(TEAM_A, 0, 10), base)).toBe(false);
  });
});

describe("resolveStructureDamage", () => {
  test("damages the structure and sets the Minion's cooldown when ready", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    const m = minion(TEAM_A, 0, 10);
    const { destroyed } = resolveStructureDamage(m, tower);
    expect(tower.hp).toBe(TOWER_HP - MINION_DAMAGE);
    expect(m.attackCooldown).toBe(MINION_ATTACK_INTERVAL);
    expect(m.engaged).toBe(true);
    expect(destroyed).toBe(false);
  });

  test("doesn't damage the structure again before the cooldown elapses", () => {
    const base = new Base(0, 0, 48, 48, TEAM_B);
    const m = minion(TEAM_A, 0, 10);
    m.attackCooldown = 5;
    const { destroyed } = resolveStructureDamage(m, base);
    expect(base.hp).toBe(BASE_HP);
    expect(destroyed).toBe(false);
  });

  test("reports destroyed once hp drops to or below zero", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    tower.hp = MINION_DAMAGE; // exactly lethal from this hit
    const m = minion(TEAM_A, 0, 10);
    const { destroyed } = resolveStructureDamage(m, tower);
    expect(tower.hp).toBeLessThanOrEqual(0);
    expect(destroyed).toBe(true);
  });

  test("the Minion doesn't attack a structure while its own hp is irrelevant to the structure", () => {
    // Structures never damage the Minion back — only the Minion attacks.
    const base = new Base(0, 0, 48, 48, TEAM_B);
    const m = minion(TEAM_A, 0, 10);
    resolveStructureDamage(m, base);
    expect(m.hp).toBe(MINION_HP);
  });
});
