import { describe, test, expect } from "vitest";
import { TEAMS } from "../shared/shared.js";
import { Minion, MINION_HP } from "../shared/minions.js";
import {
  PROJECTILE_SPEED, PROJECTILE_DAMAGE, PROJECTILE_COOLDOWN, PROJECTILE_LIFETIME,
} from "../shared/projectiles.js";
import { Tower } from "./structures.js";
import { Projectile, stepPrimaryAbility, canHit, applyProjectileDamage } from "./projectiles.js";

const [TEAM_A, TEAM_B] = TEAMS;

// A stub in place of server.js's MinionDirector — Projectile.fixedUpdate
// calls `director.resolveProjectileHit(this)` after moving (see the class
// comment on why the hit test has to happen there); movement tests below
// don't care about hit resolution, so a no-op stub keeps them focused.
function stubDirector() {
  return { resolveProjectileHit: () => {} };
}

describe("Projectile movement", () => {
  test("travels right at PROJECTILE_SPEED when facing 1", () => {
    const p = new Projectile(0, 0, TEAM_A, 1, stubDirector());
    p.fixedUpdate(1);
    expect(p.x).toBeCloseTo(PROJECTILE_SPEED, 5);
    expect(p.y).toBe(0);
  });

  test("travels left at PROJECTILE_SPEED when facing -1", () => {
    const p = new Projectile(100, 0, TEAM_A, -1, stubDirector());
    p.fixedUpdate(1);
    expect(p.x).toBeCloseTo(100 - PROJECTILE_SPEED, 5);
  });

  test("life counts down each fixedUpdate and eventually expires", () => {
    const p = new Projectile(0, 0, TEAM_A, 1, stubDirector());
    expect(p.life).toBe(PROJECTILE_LIFETIME);
    p.fixedUpdate(PROJECTILE_LIFETIME);
    expect(p.life).toBeLessThanOrEqual(0);
  });

  test("starts unspent", () => {
    const p = new Projectile(0, 0, TEAM_A, 1, stubDirector());
    expect(p.spent).toBe(false);
  });

  test("asks its director to resolve a hit after moving, unless already spent", () => {
    const calls = [];
    const director = { resolveProjectileHit: (p) => calls.push(p) };
    const p = new Projectile(0, 0, TEAM_A, 1, director);
    p.fixedUpdate(1);
    expect(calls).toEqual([p]);

    p.spent = true;
    p.fixedUpdate(1);
    expect(calls).toEqual([p]); // no second call once spent
  });
});

describe("stepPrimaryAbility", () => {
  function character() {
    return { primaryCooldown: 0, facing: 1 };
  }

  test("requests a shot on the fire key's rising edge when off cooldown", () => {
    const c = character();
    expect(stepPrimaryAbility(c, { fire: true }, 1)).toBe(true);
    expect(c.primaryCooldown).toBe(PROJECTILE_COOLDOWN);
  });

  test("does not fire when the fire key isn't pressed", () => {
    const c = character();
    expect(stepPrimaryAbility(c, { fire: false }, 1)).toBe(false);
  });

  test("does not spam-fire while the key is held", () => {
    const c = character();
    stepPrimaryAbility(c, { fire: true }, 1);
    const fired = stepPrimaryAbility(c, { fire: true }, 0.01);
    expect(fired).toBe(false);
  });

  test("re-fires on a fresh press once the cooldown has elapsed", () => {
    const c = character();
    stepPrimaryAbility(c, { fire: true }, 1);
    stepPrimaryAbility(c, { fire: false }, PROJECTILE_COOLDOWN); // release; cooldown elapses
    expect(stepPrimaryAbility(c, { fire: true }, 0)).toBe(true);
  });

  test("cannot fire again before the cooldown elapses even on a fresh press", () => {
    const c = character();
    stepPrimaryAbility(c, { fire: true }, 1);
    stepPrimaryAbility(c, { fire: false }, 0.01); // release; cooldown still active
    expect(stepPrimaryAbility(c, { fire: true }, 0)).toBe(false);
  });

  test("tracks facing from the latest movement input", () => {
    const c = character();
    stepPrimaryAbility(c, { left: true }, 0);
    expect(c.facing).toBe(-1);
    stepPrimaryAbility(c, { right: true }, 0);
    expect(c.facing).toBe(1);
  });

  test("keeps the last facing when neither left nor right is held", () => {
    const c = character();
    stepPrimaryAbility(c, { left: true }, 0);
    stepPrimaryAbility(c, {}, 0);
    expect(c.facing).toBe(-1);
  });
});

describe("canHit", () => {
  function projectile(team) {
    return { team };
  }

  test("can hit an enemy Minion", () => {
    const m = new Minion(0, 0, TEAM_B, 0, [], 0xffffff);
    expect(canHit(projectile(TEAM_A), m)).toBe(true);
  });

  test("cannot hit a same-team Minion", () => {
    const m = new Minion(0, 0, TEAM_A, 0, [], 0xffffff);
    expect(canHit(projectile(TEAM_A), m)).toBe(false);
  });

  test("cannot hit a dead Minion", () => {
    const m = new Minion(0, 0, TEAM_B, 0, [], 0xffffff);
    m.hp = 0;
    expect(canHit(projectile(TEAM_A), m)).toBe(false);
  });

  test("can hit a neutral Tower regardless of team", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    expect(canHit(projectile(TEAM_A), tower)).toBe(true);
    expect(canHit(projectile(TEAM_B), tower)).toBe(true);
  });

  test("cannot hit a destroyed Tower", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    tower.hp = 0;
    expect(canHit(projectile(TEAM_A), tower)).toBe(false);
  });

  test("non-Minion, non-Tower entities are never hit", () => {
    expect(canHit(projectile(TEAM_A), { hp: 10 })).toBe(false);
  });
});

describe("applyProjectileDamage", () => {
  test("damages the target and reports it survives above zero hp", () => {
    const m = new Minion(0, 0, TEAM_B, 0, [], 0xffffff);
    const { destroyed } = applyProjectileDamage({}, m);
    expect(m.hp).toBe(MINION_HP - PROJECTILE_DAMAGE);
    expect(destroyed).toBe(false);
  });

  test("reports destroyed once hp drops to or below zero", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    tower.hp = PROJECTILE_DAMAGE; // exactly lethal from this hit
    const { destroyed } = applyProjectileDamage({}, tower);
    expect(tower.hp).toBeLessThanOrEqual(0);
    expect(destroyed).toBe(true);
  });
});
