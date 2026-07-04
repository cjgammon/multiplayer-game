import { describe, test, expect } from "vitest";
import { TEAM_COLORS } from "./shared.js";
import {
  MSG, pickNetState, applyNetState,
  CHARACTER_STATE, MINION_STATE, TOWER_STATE, BASE_STATE, PROJECTILE_STATE,
} from "./protocol.js";

describe("MSG", () => {
  test("every lobby message kind is a distinct string", () => {
    const kinds = Object.values(MSG);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe("pickNetState", () => {
  test("reads each mapped field from the entity's server-side property", () => {
    const entity = { color: 0xff0000, _grounded: true, _prevJump: false };
    expect(pickNetState(entity, CHARACTER_STATE)).toEqual({
      color: 0xff0000,
      grounded: true,
      prevJump: false,
    });
  });

  test("an empty mapping (Tower) picks nothing", () => {
    const entity = { hp: 300 };
    expect(pickNetState(entity, TOWER_STATE)).toEqual({});
  });
});

describe("applyNetState", () => {
  test("copies a field straight through when there's no transform", () => {
    const view = {};
    applyNetState(view, { color: 0x00ff00 }, MINION_STATE);
    expect(view.tint).toBe(0x00ff00);
  });

  test("runs a field's transform before assigning it (Team id -> tint color)", () => {
    const view = {};
    applyNetState(view, { team: "A" }, BASE_STATE);
    expect(view.tint).toBe(TEAM_COLORS.A);
  });

  test("leaves the view untouched for a field missing from the payload", () => {
    const view = { tint: 0x123456 };
    applyNetState(view, {}, PROJECTILE_STATE);
    expect(view.tint).toBe(0x123456);
  });

  test("does nothing given a nullish state (e.g. before an entity's first tick)", () => {
    const view = { tint: 0x123456 };
    applyNetState(view, null, CHARACTER_STATE);
    expect(view.tint).toBe(0x123456);
  });

  test("applies every mapped field from a full Character payload", () => {
    const view = {};
    applyNetState(view, { color: 0xabcdef, grounded: true, prevJump: false }, CHARACTER_STATE);
    expect(view.tint).toBe(0xabcdef);
    expect(view._grounded).toBe(true);
    expect(view._prevJump).toBe(false);
  });

  test("one wire field can fan out to two client properties (downed -> downed + visible)", () => {
    const view = {};
    applyNetState(view, { downed: true }, CHARACTER_STATE);
    expect(view.downed).toBe(true);
    expect(view.visible).toBe(false);

    const view2 = {};
    applyNetState(view2, { downed: false }, CHARACTER_STATE);
    expect(view2.downed).toBe(false);
    expect(view2.visible).toBe(true);
  });
});
