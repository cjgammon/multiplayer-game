// maps.js — Map definitions: Lane paths, Team Bases, and per-Lane Towers.
// Lane count/shape is Map-defined, not hardcoded (see CONTEXT.md's Map/Lane
// glossary) — a Map can have a single Lane or several that converge. Both the
// server and the client import the same map definitions and call
// `buildMapData()` to get an identical Tilemap grid, exactly like the
// original empty-arena map from #1: static Map content is shared/local, not
// networked, because both sides can derive it identically at load time.
//
// Base/Tower are rendered client-side directly from this data (see
// client.js) rather than as server-owned net.spawn entities, since neither
// has any simulated state yet. When Towers/Bases gain HP/destruction, that's
// the point to move them to server-authoritative net.spawn entities — the
// position/team/lane data defined here won't need to change.
//
// A Base's `team` field uses the same "A"/"B" ids as shared.js's `TEAMS`
// (the lobby's Team select) — TEAM_COLORS for rendering also lives there.
import { TILE } from "./shared.js";

// Placeholder tint — no art pipeline yet (see CONTEXT.md decisions).
export const TOWER_COLOR = 0xd8d8d8; // neutral checkpoint, not team-owned

const BASE_SIZE = TILE * 3;
const TOWER_SIZE = TILE * 2;

function base(team, x, y) {
  return { team, x, y, w: BASE_SIZE, h: BASE_SIZE };
}

function tower(x, y) {
  return { x, y, w: TOWER_SIZE, h: TOWER_SIZE };
}

export const MAPS = {
  // A single Lane spanning the whole arena floor — the same footprint as the
  // original empty-arena map from #1.
  singleLane: {
    cols: 40,
    rows: 16,
    bases: [
      base("A", TILE, 15 * TILE - BASE_SIZE),
      base("B", 40 * TILE - TILE - BASE_SIZE, 15 * TILE - BASE_SIZE),
    ],
    lanes: [
      {
        points: [{ x: 1, y: 15 }, { x: 38, y: 15 }],
        tower: tower(20 * TILE - TOWER_SIZE / 2, 15 * TILE - TOWER_SIZE),
      },
    ],
  },

  // A top and bottom Lane that converge on a shared tile in the middle before
  // diverging again — CONTEXT.md's example of a multi-Lane Map. Both Lanes
  // rise/dip to a shared row (13) at each Base, so a Base sits on solid
  // ground connected to both Lanes rather than floating between them.
  twinLanes: {
    cols: 48,
    rows: 28,
    bases: [
      base("A", TILE, 13 * TILE - BASE_SIZE),
      base("B", 48 * TILE - TILE - BASE_SIZE, 13 * TILE - BASE_SIZE),
    ],
    lanes: [
      {
        points: [
          { x: 2, y: 13 }, { x: 2, y: 4 }, { x: 20, y: 4 }, { x: 24, y: 13 },
          { x: 28, y: 4 }, { x: 45, y: 4 }, { x: 45, y: 13 },
        ],
        tower: tower(28 * TILE - TOWER_SIZE / 2, 4 * TILE - TOWER_SIZE),
      },
      {
        points: [
          { x: 2, y: 13 }, { x: 2, y: 23 }, { x: 20, y: 23 }, { x: 24, y: 13 },
          { x: 28, y: 23 }, { x: 45, y: 23 }, { x: 45, y: 13 },
        ],
        tower: tower(28 * TILE - TOWER_SIZE / 2, 23 * TILE - TOWER_SIZE),
      },
    ],
  },
};

/** Look up a Map definition by id, throwing on an unknown one. */
export function getMap(id) {
  const map = MAPS[id];
  if (!map) throw new Error(`Unknown map id: ${id}`);
  return map;
}

/** A Map's world-space dimensions in pixels, derived from its tile grid. */
export function worldSize(map) {
  return { width: map.cols * TILE, height: map.rows * TILE };
}

/** Rasterize a Lane's polyline into solid floor tiles via `set(x, y)`. */
function rasterizeLane(points, set) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      set(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t));
    }
  }
}

/**
 * Build a Tilemap-compatible solid/empty grid for a Map: each Lane's path is
 * a walkable floor row, plus bounding side walls so Characters can't walk off
 * the world horizontally. Pure function of the Map data, called identically
 * by server and client — see the shared/local rationale above.
 */
export function buildMapData(map) {
  const data = new Array(map.cols * map.rows).fill(0);
  const set = (x, y) => {
    if (x < 0 || x >= map.cols || y < 0 || y >= map.rows) return;
    data[y * map.cols + x] = 1;
  };

  for (const lane of map.lanes) rasterizeLane(lane.points, set);

  for (let row = 0; row < map.rows; row++) {
    set(0, row);
    set(map.cols - 1, row);
  }

  return data;
}
