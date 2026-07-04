// protocol.js — the wire contract client and server both depend on: lobby
// message kinds (room.js's protocol) and each net.spawn'd entity's netState
// shape (server.js's `netState()` methods <-> client.js's View classes'
// `applyNetState`). Kept separate from shared.js, which owns simulation
// (movement constants, stepCharacter) — this is wire shape, not physics.
//
// Every entity's mapping is a list of { wireKey, serverProp, clientProp,
// transform? } entries: `wireKey` is the property name on the wire, read
// from `entity[serverProp]` by pickNetState and written to `view[clientProp]`
// (through `transform`, if given — e.g. a Team id becoming a tint color) by
// applyNetState. A field only appears here if something on the client
// actually consumes it — Character's `character` and Minion's `team` were
// dropped when this was written, since neither had a reader.
import { TEAM_COLORS } from "./shared.js";

export const MSG = {
  CREATE_ROOM: "create-room",
  JOIN_ROOM: "join-room",
  PICK_TEAM: "pick-team",
  PICK_CHARACTER: "pick-character",
  SET_READY: "set-ready",
  ROOM_STATE: "room-state",
  ERROR: "error",
  MATCH_START: "match-start",
};

export const CHARACTER_STATE = [
  { wireKey: "color", serverProp: "color", clientProp: "tint" },
  { wireKey: "grounded", serverProp: "_grounded", clientProp: "_grounded" },
  { wireKey: "prevJump", serverProp: "_prevJump", clientProp: "_prevJump" },
  { wireKey: "facing", serverProp: "facing", clientProp: "facing" },
  { wireKey: "prevDash", serverProp: "_prevDash", clientProp: "_prevDash" },
  { wireKey: "dashCooldown", serverProp: "dashCooldown", clientProp: "dashCooldown" },
  { wireKey: "dashTimer", serverProp: "dashTimer", clientProp: "dashTimer" },
  { wireKey: "speedMultiplier", serverProp: "speedMultiplier", clientProp: "speedMultiplier" },
  { wireKey: "solar", serverProp: "solar", clientProp: "solar" },
  { wireKey: "hp", serverProp: "hp", clientProp: "hp" },
  // Downed (#9): two client fields from one wire field — `downed` itself
  // (read by the `simulate` callback to skip predicting a downed local
  // player) plus `visible`, derived via transform, so a downed Character is
  // hidden rather than despawned (see respawn.js's header comment on why the
  // server keeps simulating/networking the same entity through its respawn
  // timer instead of a real net.spawn/despawn round-trip).
  { wireKey: "downed", serverProp: "downed", clientProp: "downed" },
  { wireKey: "downed", serverProp: "downed", clientProp: "visible", transform: (downed) => !downed },
];

export const MINION_STATE = [
  { wireKey: "color", serverProp: "color", clientProp: "tint" },
];

// Tower's hp/destruction is server-authoritative but never synced to the
// client — a destroyed Tower is despawned outright rather than shown
// damaged, so there's nothing here to pick or apply.
export const TOWER_STATE = [];

export const BASE_STATE = [
  { wireKey: "team", serverProp: "team", clientProp: "tint", transform: (team) => TEAM_COLORS[team] },
];

export const PROJECTILE_STATE = [
  { wireKey: "team", serverProp: "team", clientProp: "tint", transform: (team) => TEAM_COLORS[team] },
];

// SolarPickupView renders a fixed gold tint and reads nothing dynamic — see
// shared/solar.js's SolarPickup.netState() — so, like Tower, there's nothing
// here to pick or apply. `amount` is used only server-side (crediting the
// collecting Character) and never crosses the wire.
export const SOLAR_STATE = [];

/** Server side: builds the netState payload for `entity` from its mapping. */
export function pickNetState(entity, mapping) {
  const state = {};
  for (const { wireKey, serverProp } of mapping) state[wireKey] = entity[serverProp];
  return state;
}

/** Client side: applies a netState payload to `view` from its mapping.
 *  Skips any field missing from `state` (e.g. a snapshot taken before the
 *  entity's first tick) rather than overwriting with undefined. */
export function applyNetState(view, state, mapping) {
  if (!state) return;
  for (const { wireKey, clientProp, transform } of mapping) {
    if (state[wireKey] === undefined) continue;
    view[clientProp] = transform ? transform(state[wireKey]) : state[wireKey];
  }
}
