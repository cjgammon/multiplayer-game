import { describe, test, expect } from "vitest";
import { Entity, Tilemap } from "@cjgammon/gamekit";
import {
  stepCharacter,
  CHAR_W,
  CHAR_H,
  DRAG_X,
  MAX_VEL_X,
  MAX_VEL_Y,
  DASH_SPEED,
  DASH_DURATION,
  DASH_COOLDOWN,
  TILE,
} from "../shared.js";

const NO_INPUT = { left: false, right: false, jump: false, dash: false };

// A flat, open tilemap: solid floor along the bottom row only, everything
// above is empty — enough for dash movement tests that don't care about
// gravity/grounding, plus a dedicated solid-wall variant for collision tests.
function makeTilemap({ cols = 40, rows = 10, wallCol = null } = {}) {
  const data = new Array(cols * rows).fill(0);
  for (let c = 0; c < cols; c++) data[(rows - 1) * cols + c] = 1; // floor
  if (wallCol !== null) {
    for (let r = 0; r < rows; r++) data[r * cols + wallCol] = 1;
  }
  return new Tilemap(cols, rows, TILE, TILE, data);
}

function makeCharacter(x, y) {
  const e = new Entity(x, y);
  e.width = CHAR_W;
  e.height = CHAR_H;
  e.drag.set(DRAG_X, 0);
  e.maxVelocity.set(MAX_VEL_X, MAX_VEL_Y);
  e.facing = 1;
  e.dashCooldown = 0;
  e.dashTimer = 0;
  return e;
}

describe("stepCharacter facing", () => {
  test("tracks facing from the latest movement input", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    stepCharacter(e, { ...NO_INPUT, left: true }, 0.05, tilemap);
    expect(e.facing).toBe(-1);
    stepCharacter(e, { ...NO_INPUT, right: true }, 0.05, tilemap);
    expect(e.facing).toBe(1);
  });

  test("keeps the last facing when neither left nor right is held", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    stepCharacter(e, { ...NO_INPUT, left: true }, 0.05, tilemap);
    stepCharacter(e, NO_INPUT, 0.05, tilemap);
    expect(e.facing).toBe(-1);
  });
});

describe("stepCharacter dash", () => {
  test("does nothing without dash input", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    stepCharacter(e, NO_INPUT, 0.05, tilemap);
    expect(e.dashTimer).toBe(0);
    expect(e.dashCooldown).toBe(0);
  });

  test("dash burst exceeds normal MAX_VEL_X", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    stepCharacter(e, { ...NO_INPUT, dash: true }, 0.05, tilemap);
    expect(Math.abs(e.velocity.x)).toBeGreaterThan(MAX_VEL_X);
  });

  test("dash moves the Character in its facing direction", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    e.facing = 1;
    const startX = e.x;
    stepCharacter(e, { ...NO_INPUT, dash: true }, 0.05, tilemap);
    expect(e.x).toBeGreaterThan(startX);

    const e2 = makeCharacter(TILE * 5, 0);
    e2.facing = -1;
    const startX2 = e2.x;
    stepCharacter(e2, { ...NO_INPUT, dash: true }, 0.05, tilemap);
    expect(e2.x).toBeLessThan(startX2);
  });

  test("dash is edge-triggered: holding the key doesn't refresh the cooldown mid-dash", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    const input = { ...NO_INPUT, dash: true };
    stepCharacter(e, input, 0.05, tilemap);
    const cooldownAfterFirstTick = e.dashCooldown;
    stepCharacter(e, input, 0.05, tilemap); // still holding
    expect(e.dashCooldown).toBeLessThan(cooldownAfterFirstTick);
    expect(e.dashCooldown).toBeCloseTo(cooldownAfterFirstTick - 0.05, 5);
  });

  test("dash is cooldown-gated: can't dash again until cooldown elapses", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    stepCharacter(e, { ...NO_INPUT, dash: true }, DASH_DURATION, tilemap); // finish the dash
    expect(e.dashTimer).toBeLessThanOrEqual(0);
    expect(e.dashCooldown).toBeGreaterThan(0);

    // Release and re-press dash while still on cooldown — must not re-trigger.
    stepCharacter(e, NO_INPUT, 0.01, tilemap);
    stepCharacter(e, { ...NO_INPUT, dash: true }, 0.01, tilemap);
    expect(Math.abs(e.velocity.x)).toBeLessThanOrEqual(MAX_VEL_X);

    // Wait out the cooldown, release, then press again — now it should fire.
    stepCharacter(e, NO_INPUT, DASH_COOLDOWN, tilemap);
    expect(e.dashCooldown).toBeLessThanOrEqual(0);
    stepCharacter(e, { ...NO_INPUT, dash: true }, 0.01, tilemap);
    expect(Math.abs(e.velocity.x)).toBeGreaterThan(MAX_VEL_X);
  });

  test("normal movement resumes once the dash duration elapses", () => {
    const tilemap = makeTilemap();
    const e = makeCharacter(TILE * 5, 0);
    stepCharacter(e, { ...NO_INPUT, dash: true }, DASH_DURATION + 0.01, tilemap);
    expect(e.dashTimer).toBeLessThanOrEqual(0);
    // Back under normal accel/drag rules: standing still with no input decays velocity.
    stepCharacter(e, NO_INPUT, 1, tilemap);
    expect(e.velocity.x).toBe(0);
  });

  test("dash respects Tilemap collision — stops at a solid wall", () => {
    const wallCol = 6;
    const tilemap = makeTilemap({ wallCol });
    const e = makeCharacter(TILE * 5, 0);
    e.facing = 1;
    for (let i = 0; i < 20; i++) {
      stepCharacter(e, { ...NO_INPUT, dash: (e.dashCooldown <= 0 && i === 0) }, 0.05, tilemap);
    }
    expect(e.x + e.width).toBeLessThanOrEqual(wallCol * TILE);
  });
});
