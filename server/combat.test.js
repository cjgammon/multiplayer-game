import { describe, test, expect } from "vitest";
import { TEAMS } from "../shared/shared.js";
import { Minion, MINION_DAMAGE } from "../shared/minions.js";
import { Tower, Base, TOWER_HP, BASE_HP } from "./structures.js";
import { PROJECTILE_DAMAGE } from "../shared/projectiles.js";
import { Projectile } from "./projectiles.js";
import { resolveStructureCombat, resolveProjectileHit } from "./combat.js";

const [TEAM_A, TEAM_B] = TEAMS;

function minion(team, laneIndex, x = 10) {
  return new Minion(x, 0, team, laneIndex, [], 0xffffff);
}

describe("resolveStructureCombat", () => {
  test("a Minion engaging its own Lane's Tower damages it and reports no event while it survives", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    const base = new Base(0, 100, 48, 48, TEAM_B);
    const events = resolveStructureCombat([minion(TEAM_A, 0)], [tower], [base]);
    expect(tower.hp).toBe(TOWER_HP - MINION_DAMAGE);
    expect(events).toEqual([]);
  });

  test("reports towerDestroyed once a Lane's Tower dies, and doesn't also check that Minion against a Base this tick", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    tower.hp = MINION_DAMAGE; // exactly lethal from this hit
    const base = new Base(0, 100, 48, 48, TEAM_B);
    const events = resolveStructureCombat([minion(TEAM_A, 0)], [tower], [base]);
    expect(events).toEqual([{ type: "towerDestroyed", tower }]);
  });

  test("a Minion can't reach the Base while its own Lane's Tower is still alive", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    const base = new Base(0, 100, 48, 48, TEAM_B);
    const events = resolveStructureCombat([minion(TEAM_A, 0)], [tower], [base]);
    expect(base.hp).toBe(BASE_HP);
    expect(events).toEqual([]);
  });

  test("once the Lane's Tower is destroyed, a Minion can engage the enemy Base and reports baseDestroyed", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    tower.hp = 0;
    const base = new Base(0, 100, 48, 48, TEAM_B);
    base.hp = MINION_DAMAGE; // exactly lethal from this hit
    const events = resolveStructureCombat([minion(TEAM_A, 0)], [tower], [base]);
    expect(events).toEqual([{ type: "baseDestroyed", base }]);
  });

  test("a dead Minion is skipped entirely", () => {
    const tower = new Tower(0, 100, 32, 32, 0);
    const base = new Base(0, 100, 48, 48, TEAM_B);
    const m = minion(TEAM_A, 0);
    m.hp = 0;
    const events = resolveStructureCombat([m], [tower], [base]);
    expect(tower.hp).toBe(TOWER_HP);
    expect(events).toEqual([]);
  });

  test("reports multiple events across different Lanes in the same tick", () => {
    const towerA = new Tower(0, 100, 32, 32, 0);
    towerA.hp = MINION_DAMAGE;
    const towerB = new Tower(0, 100, 32, 32, 1);
    towerB.hp = MINION_DAMAGE;
    const events = resolveStructureCombat(
      [minion(TEAM_A, 0), minion(TEAM_A, 1)],
      [towerA, towerB],
      [],
    );
    expect(events).toEqual([
      { type: "towerDestroyed", tower: towerA },
      { type: "towerDestroyed", tower: towerB },
    ]);
  });
});

describe("resolveProjectileHit", () => {
  function projectile(team) {
    return new Projectile(0, 0, team, 1, { resolveProjectileHit: () => {} });
  }

  test("a live Projectile hitting an enemy Minion damages it and reports the hit", () => {
    const p = projectile(TEAM_A);
    const target = minion(TEAM_B, 0);
    const hpBefore = target.hp;
    const result = resolveProjectileHit(p, target);
    expect(target.hp).toBe(hpBefore - PROJECTILE_DAMAGE);
    expect(result.hit).toBe(true);
    expect(result.isMinion).toBe(true);
    expect(p.spent).toBe(true);
  });

  test("reports destroyed once the target's hp drops to or below zero", () => {
    const p = projectile(TEAM_A);
    const tower = new Tower(0, 0, 32, 32, 0);
    tower.hp = PROJECTILE_DAMAGE;
    const result = resolveProjectileHit(p, tower);
    expect(result.destroyed).toBe(true);
    expect(result.isMinion).toBe(false);
  });

  test("an already-spent Projectile can't hit anything else", () => {
    const p = projectile(TEAM_A);
    p.spent = true;
    const target = minion(TEAM_B, 0);
    const result = resolveProjectileHit(p, target);
    expect(result.hit).toBe(false);
    expect(target.hp).toBeGreaterThan(0);
  });

  test("a Projectile can't hit its own Team's Minion", () => {
    const p = projectile(TEAM_A);
    const target = minion(TEAM_A, 0);
    const result = resolveProjectileHit(p, target);
    expect(result.hit).toBe(false);
    expect(p.spent).toBe(false);
  });
});
