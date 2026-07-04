import { describe, test, expect } from "vitest";
import { TEAMS } from "../shared/shared.js";
import { Minion, MINION_HP } from "../shared/minions.js";
import { Tower } from "./structures.js";
import { MELEE_RANGE, MELEE_HEIGHT_PAD, MELEE_DAMAGE } from "../shared/melee.js";
import { meleeHitbox, canHitMelee, applyMeleeDamage } from "./melee.js";

const [TEAM_A, TEAM_B] = TEAMS;

function attacker({
  x = 0, y = 0, width = 14, height = 20, team = TEAM_A, facing = 1, damageMultiplier = 1,
} = {}) {
  return { x, y, width, height, team, facing, hp: 100, character: "brawler", damageMultiplier };
}

describe("meleeHitbox", () => {
  test("extends MELEE_RANGE past the leading edge when facing right", () => {
    const a = attacker({ x: 10, y: 5, width: 14, height: 20, facing: 1 });
    const hb = meleeHitbox(a);
    expect(hb.x).toBe(a.x + a.width);
    expect(hb.width).toBe(MELEE_RANGE);
  });

  test("extends MELEE_RANGE past the leading edge when facing left", () => {
    const a = attacker({ x: 10, y: 5, width: 14, height: 20, facing: -1 });
    const hb = meleeHitbox(a);
    expect(hb.x).toBe(a.x - MELEE_RANGE);
  });

  test("pads the hitbox vertically around the Character's height", () => {
    const a = attacker({ x: 0, y: 5, width: 14, height: 20 });
    const hb = meleeHitbox(a);
    expect(hb.y).toBe(a.y - MELEE_HEIGHT_PAD);
    expect(hb.height).toBe(a.height + MELEE_HEIGHT_PAD * 2);
  });
});

describe("canHitMelee", () => {
  test("can hit an enemy Minion", () => {
    const m = new Minion(0, 0, TEAM_B, 0, [], 0xffffff);
    expect(canHitMelee(attacker({ team: TEAM_A }), m)).toBe(true);
  });

  test("cannot hit a same-team Minion", () => {
    const m = new Minion(0, 0, TEAM_A, 0, [], 0xffffff);
    expect(canHitMelee(attacker({ team: TEAM_A }), m)).toBe(false);
  });

  test("cannot hit a dead Minion", () => {
    const m = new Minion(0, 0, TEAM_B, 0, [], 0xffffff);
    m.hp = 0;
    expect(canHitMelee(attacker({ team: TEAM_A }), m)).toBe(false);
  });

  test("can hit a neutral Tower regardless of team", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    expect(canHitMelee(attacker({ team: TEAM_A }), tower)).toBe(true);
    expect(canHitMelee(attacker({ team: TEAM_B }), tower)).toBe(true);
  });

  test("cannot hit a destroyed Tower", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    tower.hp = 0;
    expect(canHitMelee(attacker({ team: TEAM_A }), tower)).toBe(false);
  });

  test("can hit an enemy Character", () => {
    const target = { team: TEAM_B, hp: 100, character: "naut" };
    expect(canHitMelee(attacker({ team: TEAM_A }), target)).toBe(true);
  });

  test("cannot hit a same-team Character", () => {
    const target = { team: TEAM_A, hp: 100, character: "naut" };
    expect(canHitMelee(attacker({ team: TEAM_A }), target)).toBe(false);
  });

  test("cannot hit a dead Character", () => {
    const target = { team: TEAM_B, hp: 0, character: "naut" };
    expect(canHitMelee(attacker({ team: TEAM_A }), target)).toBe(false);
  });

  test("cannot hit itself", () => {
    const a = attacker({ team: TEAM_A });
    expect(canHitMelee(a, a)).toBe(false);
  });

  test("cannot hit a Base (only Minions/Towers/Characters are meleeable)", () => {
    const base = { team: TEAM_B, hp: 500 };
    expect(canHitMelee(attacker({ team: TEAM_A }), base)).toBe(false);
  });
});

describe("applyMeleeDamage", () => {
  test("damages the target and reports it survives above zero hp", () => {
    const m = new Minion(0, 0, TEAM_B, 0, [], 0xffffff);
    const { destroyed } = applyMeleeDamage(attacker(), m);
    expect(m.hp).toBe(MINION_HP - MELEE_DAMAGE);
    expect(destroyed).toBe(false);
  });

  test("reports destroyed once hp drops to or below zero", () => {
    const tower = new Tower(0, 0, 32, 32, 0);
    tower.hp = MELEE_DAMAGE; // exactly lethal from this hit
    const { destroyed } = applyMeleeDamage(attacker(), tower);
    expect(tower.hp).toBeLessThanOrEqual(0);
    expect(destroyed).toBe(true);
  });

  test("scales damage by the attacker's damage Upgrade multiplier", () => {
    const m = new Minion(0, 0, TEAM_B, 0, [], 0xffffff);
    const { destroyed } = applyMeleeDamage(attacker({ damageMultiplier: 2 }), m);
    expect(m.hp).toBe(MINION_HP - MELEE_DAMAGE * 2);
    expect(destroyed).toBe(false);
  });
});
