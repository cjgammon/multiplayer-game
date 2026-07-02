import { describe, test, expect } from "vitest";
import { TILE, TEAM_A, TEAM_B, MAPS, getMap, buildMapData } from "../maps.js";

describe("getMap", () => {
  test("returns the singleLane map with one lane and two bases", () => {
    const map = getMap("singleLane");
    expect(map.lanes).toHaveLength(1);
    expect(map.bases).toHaveLength(2);
  });

  test("returns the twinLanes map with two lanes and two bases", () => {
    const map = getMap("twinLanes");
    expect(map.lanes).toHaveLength(2);
    expect(map.bases).toHaveLength(2);
  });

  test("throws on an unknown map id", () => {
    expect(() => getMap("nonexistent")).toThrow(/nonexistent/);
  });

  for (const id of Object.keys(MAPS)) {
    test(`${id}: bases belong to two distinct teams`, () => {
      const map = getMap(id);
      const teams = map.bases.map((b) => b.team).sort();
      expect(teams).toEqual([TEAM_A, TEAM_B]);
    });

    test(`${id}: every lane has a path of at least two points and one tower`, () => {
      const map = getMap(id);
      for (const lane of map.lanes) {
        expect(lane.points.length).toBeGreaterThanOrEqual(2);
        expect(lane.tower).toMatchObject({
          x: expect.any(Number),
          y: expect.any(Number),
          w: expect.any(Number),
          h: expect.any(Number),
        });
      }
    });

    test(`${id}: bases have world-space position and size`, () => {
      const map = getMap(id);
      for (const base of map.bases) {
        expect(base).toMatchObject({
          x: expect.any(Number),
          y: expect.any(Number),
          w: expect.any(Number),
          h: expect.any(Number),
        });
      }
    });
  }
});

describe("buildMapData", () => {
  test("singleLane reproduces the original empty-arena grid: solid floor row + side walls", () => {
    const map = getMap("singleLane");
    const data = buildMapData(map);
    expect(data).toHaveLength(map.cols * map.rows);

    for (let col = 0; col < map.cols; col++) {
      expect(data[(map.rows - 1) * map.cols + col]).toBe(1); // floor
    }
    for (let row = 0; row < map.rows; row++) {
      expect(data[row * map.cols]).toBe(1); // left wall
      expect(data[row * map.cols + map.cols - 1]).toBe(1); // right wall
    }
    // Nothing solid floating in open sky above the floor away from the walls.
    expect(data[1 * map.cols + Math.floor(map.cols / 2)]).toBe(0);
  });

  test("twinLanes rasterizes solid tiles under each lane's own path", () => {
    const map = getMap("twinLanes");
    const data = buildMapData(map);
    const isSolid = (x, y) => data[y * map.cols + x] === 1;

    for (const lane of map.lanes) {
      for (const point of lane.points) {
        expect(isSolid(point.x, point.y)).toBe(true);
      }
    }
  });

  test("twinLanes lanes share a convergence tile", () => {
    const map = getMap("twinLanes");
    const [laneA, laneB] = map.lanes;
    const key = (p) => `${p.x},${p.y}`;
    const aKeys = new Set(laneA.points.map(key));
    const shared = laneB.points.some((p) => aKeys.has(key(p)));
    expect(shared).toBe(true);
  });

  test("bounding side walls exist across the full height for every map", () => {
    for (const id of Object.keys(MAPS)) {
      const map = getMap(id);
      const data = buildMapData(map);
      for (let row = 0; row < map.rows; row++) {
        expect(data[row * map.cols]).toBe(1);
        expect(data[row * map.cols + map.cols - 1]).toBe(1);
      }
    }
  });

  test("every base rests on solid ground connected to a lane, not floating", () => {
    for (const id of Object.keys(MAPS)) {
      const map = getMap(id);
      const data = buildMapData(map);
      const isSolid = (x, y) => data[y * map.cols + x] === 1;

      for (const base of map.bases) {
        const row = (base.y + base.h) / TILE; // tile row just below the base
        const firstCol = Math.floor(base.x / TILE);
        const lastCol = Math.floor((base.x + base.w - 1) / TILE);
        let onGround = false;
        for (let col = firstCol; col <= lastCol; col++) {
          if (isSolid(col, row)) onGround = true;
        }
        expect(onGround).toBe(true);
      }
    }
  });
});
