import { describe, test, expect } from "vitest";
import { stepPrimaryAbility } from "./abilities.js";

const COOLDOWN = 0.5;

describe("stepPrimaryAbility", () => {
  function character() {
    return { primaryCooldown: 0, facing: 1 };
  }

  test("requests a fire on the fire key's rising edge when off cooldown", () => {
    const c = character();
    expect(stepPrimaryAbility(c, { fire: true }, 1, COOLDOWN)).toBe(true);
    expect(c.primaryCooldown).toBe(COOLDOWN);
  });

  test("does not fire when the fire key isn't pressed", () => {
    const c = character();
    expect(stepPrimaryAbility(c, { fire: false }, 1, COOLDOWN)).toBe(false);
  });

  test("does not spam-fire while the key is held", () => {
    const c = character();
    stepPrimaryAbility(c, { fire: true }, 1, COOLDOWN);
    const fired = stepPrimaryAbility(c, { fire: true }, 0.01, COOLDOWN);
    expect(fired).toBe(false);
  });

  test("re-fires on a fresh press once the cooldown has elapsed", () => {
    const c = character();
    stepPrimaryAbility(c, { fire: true }, 1, COOLDOWN);
    stepPrimaryAbility(c, { fire: false }, COOLDOWN, COOLDOWN); // release; cooldown elapses
    expect(stepPrimaryAbility(c, { fire: true }, 0, COOLDOWN)).toBe(true);
  });

  test("cannot fire again before the cooldown elapses even on a fresh press", () => {
    const c = character();
    stepPrimaryAbility(c, { fire: true }, 1, COOLDOWN);
    stepPrimaryAbility(c, { fire: false }, 0.01, COOLDOWN); // release; cooldown still active
    expect(stepPrimaryAbility(c, { fire: true }, 0, COOLDOWN)).toBe(false);
  });

  test("a different kit's cooldown length is respected independently", () => {
    const shortCooldown = 0.1;
    const c = character();
    stepPrimaryAbility(c, { fire: true }, 1, shortCooldown);
    stepPrimaryAbility(c, { fire: false }, shortCooldown, shortCooldown); // release; this kit's shorter cooldown elapses
    expect(stepPrimaryAbility(c, { fire: true }, 0, shortCooldown)).toBe(true);
  });
});
