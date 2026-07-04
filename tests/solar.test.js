import { describe, test, expect } from "vitest";
import { TEAMS } from "../shared.js";
import { Base } from "../structures.js";
import {
  SolarPickup,
  SOLAR_PICKUP_SIZE,
  UPGRADES,
  canCollect,
  resolveCollect,
  canPurchaseUpgrade,
  resolvePurchaseUpgrade,
} from "../solar.js";

const [TEAM_A, TEAM_B] = TEAMS;

function character({ x = 0, y = 0, team = TEAM_A, hp = 100, solar = 0, upgrades = {} } = {}) {
  return { x, y, width: 14, height: 20, team, hp, solar, upgrades, character: "naut" };
}

describe("SolarPickup", () => {
  test("carries its Solar amount and starts uncollected", () => {
    const pickup = new SolarPickup(10, 20, 5);
    expect(pickup.x).toBe(10);
    expect(pickup.y).toBe(20);
    expect(pickup.width).toBe(SOLAR_PICKUP_SIZE);
    expect(pickup.height).toBe(SOLAR_PICKUP_SIZE);
    expect(pickup.amount).toBe(5);
    expect(pickup.collected).toBe(false);
  });
});

describe("canCollect", () => {
  test("a live Character can collect an uncollected pickup", () => {
    expect(canCollect(character(), new SolarPickup(0, 0, 5))).toBe(true);
  });

  test("a dead Character cannot collect", () => {
    expect(canCollect(character({ hp: 0 }), new SolarPickup(0, 0, 5))).toBe(false);
  });

  test("a pickup already collected this tick cannot be collected again", () => {
    const pickup = new SolarPickup(0, 0, 5);
    pickup.collected = true;
    expect(canCollect(character(), pickup)).toBe(false);
  });
});

describe("resolveCollect", () => {
  test("credits the pickup's amount to the Character's Solar total and marks it collected", () => {
    const c = character({ solar: 10 });
    const pickup = new SolarPickup(0, 0, 5);
    resolveCollect(c, pickup);
    expect(c.solar).toBe(15);
    expect(pickup.collected).toBe(true);
  });
});

describe("canPurchaseUpgrade", () => {
  function ownBase(team = TEAM_A) {
    return new Base(0, 0, 32, 32, team);
  }

  test("can buy an affordable Upgrade while standing in own Team's Base", () => {
    const c = character({ x: 5, y: 5, solar: 100 });
    expect(canPurchaseUpgrade(c, ownBase(), "damage")).toBe(true);
  });

  test("cannot buy an unknown Upgrade id", () => {
    const c = character({ x: 5, y: 5, solar: 100 });
    expect(canPurchaseUpgrade(c, ownBase(), "nope")).toBe(false);
  });

  test("cannot buy without enough Solar", () => {
    const c = character({ x: 5, y: 5, solar: 1 });
    expect(canPurchaseUpgrade(c, ownBase(), "damage")).toBe(false);
  });

  test("cannot buy the same Upgrade twice", () => {
    const c = character({ x: 5, y: 5, solar: 100, upgrades: { damage: true } });
    expect(canPurchaseUpgrade(c, ownBase(), "damage")).toBe(false);
  });

  test("cannot buy at the enemy Team's Base", () => {
    const c = character({ x: 5, y: 5, team: TEAM_A, solar: 100 });
    expect(canPurchaseUpgrade(c, ownBase(TEAM_B), "damage")).toBe(false);
  });

  test("cannot buy while standing outside the Base", () => {
    const c = character({ x: 500, y: 500, solar: 100 });
    expect(canPurchaseUpgrade(c, ownBase(), "damage")).toBe(false);
  });
});

describe("resolvePurchaseUpgrade", () => {
  test("deducts cost, marks bought, and applies the damage Upgrade's effect", () => {
    const c = character({ solar: 100 });
    resolvePurchaseUpgrade(c, "damage");
    expect(c.solar).toBe(100 - UPGRADES.damage.cost);
    expect(c.upgrades.damage).toBe(true);
    expect(c.damageMultiplier).toBe(UPGRADES.damage.damageMultiplier);
  });

  test("deducts cost, marks bought, and applies the speed Upgrade's effect", () => {
    const c = character({ solar: 100 });
    resolvePurchaseUpgrade(c, "speed");
    expect(c.solar).toBe(100 - UPGRADES.speed.cost);
    expect(c.upgrades.speed).toBe(true);
    expect(c.speedMultiplier).toBe(UPGRADES.speed.speedMultiplier);
  });
});
