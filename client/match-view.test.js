import { describe, test, expect } from "vitest";
import { TEAM_COLORS, CHAR_W, CHAR_H } from "../shared/shared.js";
import { MINION_W, MINION_H } from "../shared/minions.js";
import { TOWER_SIZE, BASE_SIZE, TOWER_COLOR } from "../shared/maps.js";
import { PROJECTILE_W, PROJECTILE_H } from "../shared/projectiles.js";
import {
  CharacterView, MinionView, TowerView, BaseView, ProjectileView,
} from "./match-view.js";

describe("CharacterView", () => {
  test("constructs at Character's configured size", () => {
    const view = new CharacterView();
    expect(view.width).toBe(CHAR_W);
    expect(view.height).toBe(CHAR_H);
  });

  test("applyNetState sets tint/grounded/prevJump from the server payload", () => {
    const view = new CharacterView();
    view.applyNetState({ color: 0xabcdef, grounded: true, prevJump: false });
    expect(view.tint).toBe(0xabcdef);
    expect(view._grounded).toBe(true);
    expect(view._prevJump).toBe(false);
  });

  test("applyNetState is a no-op given a nullish payload", () => {
    const view = new CharacterView();
    view.tint = 0x111111;
    view.applyNetState(null);
    expect(view.tint).toBe(0x111111);
  });
});

describe("MinionView", () => {
  test("constructs at Minion's configured size", () => {
    const view = new MinionView();
    expect(view.width).toBe(MINION_W);
    expect(view.height).toBe(MINION_H);
  });

  test("applyNetState sets tint from color", () => {
    const view = new MinionView();
    view.applyNetState({ color: 0x00ff00 });
    expect(view.tint).toBe(0x00ff00);
  });
});

describe("TowerView", () => {
  test("constructs at Tower's configured size, tinted TOWER_COLOR", () => {
    const view = new TowerView();
    expect(view.width).toBe(TOWER_SIZE);
    expect(view.height).toBe(TOWER_SIZE);
    expect(view.tint).toBe(TOWER_COLOR);
  });

  test("has no applyNetState — Tower's HP/destruction isn't synced to the client", () => {
    const view = new TowerView();
    expect(view.applyNetState).toBeUndefined();
  });
});

describe("BaseView", () => {
  test("constructs at Base's configured size", () => {
    const view = new BaseView();
    expect(view.width).toBe(BASE_SIZE);
    expect(view.height).toBe(BASE_SIZE);
  });

  test("applyNetState derives tint from Team via TEAM_COLORS", () => {
    const view = new BaseView();
    view.applyNetState({ team: "A" });
    expect(view.tint).toBe(TEAM_COLORS.A);
  });
});

describe("ProjectileView", () => {
  test("constructs at Projectile's configured size", () => {
    const view = new ProjectileView();
    expect(view.width).toBe(PROJECTILE_W);
    expect(view.height).toBe(PROJECTILE_H);
  });

  test("applyNetState derives tint from Team via TEAM_COLORS", () => {
    const view = new ProjectileView();
    view.applyNetState({ team: "B" });
    expect(view.tint).toBe(TEAM_COLORS.B);
  });
});
