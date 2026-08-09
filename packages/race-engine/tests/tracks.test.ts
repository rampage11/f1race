import { describe, expect, it } from "vitest";
import {
  TRACKS,
  TRACK_FACTORIES,
  interlagos,
  monza,
  mulberry32,
  randomTrack,
  redBullRing,
  recommendedLaps,
  trackById,
  type Track,
} from "../src/index.js";

describe("track registry", () => {
  it("TRACKS holds all three tracks and factories match", () => {
    expect(TRACKS).toHaveLength(3);
    expect(TRACK_FACTORIES).toHaveLength(3);
    const ids = TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("randomTrack returns one of the registered tracks", () => {
    const rng = mulberry32(42);
    const ids = new Set(TRACKS.map((t) => t.id));
    for (let i = 0; i < 30; i++) expect(ids.has(randomTrack(rng).id)).toBe(true);
  });

  it("trackById round-trips every registered id and misses unknowns", () => {
    for (const t of TRACKS) expect(trackById(t.id)?.id).toBe(t.id);
    expect(trackById("does-not-exist")).toBeUndefined();
  });
});

describe("individual track factories", () => {
  const checks: Array<{
    name: string;
    factory: () => Track;
    id: string;
    specLenM: number;
    specLaps: number;
    drsCount: number;
  }> = [
    { name: "monza", factory: monza, id: "monza", specLenM: 5793, specLaps: 9, drsCount: 2 },
    { name: "interlagos", factory: interlagos, id: "interlagos", specLenM: 4309, specLaps: 12, drsCount: 1 },
    { name: "redBullRing", factory: redBullRing, id: "red_bull_ring", specLenM: 4318, specLaps: 12, drsCount: 3 },
  ];

  for (const c of checks) {
    it(`${c.name} produces a valid track`, () => {
      const t = c.factory();
      expect(t.id).toBe(c.id);
      expect(t.laps).toBe(c.specLaps);
      expect(t.path2D.length).toBeGreaterThanOrEqual(8);
      expect(t.drsZones).toHaveLength(c.drsCount);
      expect(t.sectors).toHaveLength(2);
      expect(t.segments.length).toBeGreaterThan(0);
      expect(t.lengthM).toBeGreaterThan(0);
      if (c.specLenM > 0) {
        expect(t.lengthM).toBeGreaterThan(c.specLenM * 0.85);
        expect(t.lengthM).toBeLessThan(c.specLenM * 1.15);
      }
      for (const z of t.drsZones) {
        expect(z.startS).toBeLessThanOrEqual(z.endS);
        expect(z.startS).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("redBullRing has 3 DRS zones and 2 sector splits", () => {
    const t = redBullRing();
    expect(t.drsZones).toHaveLength(3);
    expect(t.sectors).toHaveLength(2);
  });

  it("recommendedLaps still works for every track", () => {
    for (const t of TRACKS) {
      const laps = recommendedLaps(t);
      expect(laps).toBeGreaterThanOrEqual(1);
    }
  });
});
