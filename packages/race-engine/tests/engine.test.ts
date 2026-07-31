import { describe, expect, it } from "vitest";
import {
  RaceEngine,
  buildRaceConfig,
  makeBot,
  makeDriver,
  redBullRing,
  runQualifying,
  baseLapTime,
  emptySkills,
  mulberry32,
  type Driver,
} from "../src/index.js";

function field(seed: number, heroDriver?: Driver): Driver[] {
  const rng = mulberry32(seed);
  const bots: Driver[] = [];
  for (let i = 0; i < 9; i++) bots.push(makeBot({}, rng));
  return heroDriver ? [heroDriver, ...bots] : bots;
}

function gridFrom(field: Driver[], seed: number): Driver[] {
  const t0 = baseLapTime(redBullRing());
  const q = runQualifying(field, t0, mulberry32(seed * 7 + 1));
  return q
    .map((row) => field.find((d) => d.id === row.driverId)!)
    .sort((a, b) => q.find((r) => r.driverId === a.id)!.gridPosition - q.find((r) => r.driverId === b.id)!.gridPosition);
}

describe("RaceEngine", () => {
  it("runs to completion and ranks every car", () => {
    const track = redBullRing();
    const drivers = gridFrom(field(1), 1);
    const cfg = buildRaceConfig({ track, drivers, totalLaps: 10, seed: 123, dt: 0.1 });
    const engine = new RaceEngine(cfg);
    const result = engine.run();

    expect(engine.phase).toBe("finished");
    expect(result.rows).toHaveLength(drivers.length);
    const places = result.rows.map((r) => r.place).sort((a, b) => a - b);
    expect(places).toEqual(Array.from({ length: drivers.length }, (_, i) => i + 1));
  });

  it("race times are monotonic with finishing order", () => {
    const track = redBullRing();
    const drivers = gridFrom(field(2), 2);
    const cfg = buildRaceConfig({ track, drivers, totalLaps: 10, seed: 999, dt: 0.1 });
    const result = new RaceEngine(cfg).run();
    for (let i = 1; i < result.rows.length; i++) {
      const prev = result.rows[i - 1]!;
      const cur = result.rows[i]!;
      expect(cur.raceTime).toBeGreaterThanOrEqual(prev.raceTime - 0.001);
    }
  });

  it("is deterministic for the same seed", () => {
    const track = redBullRing();
    const seed = 555;
    const drivers = gridFrom(field(3), 3);
    const runOnce = () => new RaceEngine(buildRaceConfig({ track, drivers, totalLaps: 8, seed, dt: 0.1 })).run();
    const a = runOnce();
    const b = runOnce();
    expect(a.rows.map((r) => r.driverId)).toEqual(b.rows.map((r) => r.driverId));
    expect(a.rows.map((r) => r.raceTime)).toEqual(b.rows.map((r) => r.raceTime));
    expect(a.events.length).toEqual(b.events.length);
  });

  it("forces at least one tyre stop per car", () => {
    const track = redBullRing();
    const drivers = gridFrom(field(4), 4);
    const cfg = buildRaceConfig({ track, drivers, totalLaps: 15, seed: 42, dt: 0.1 });
    const result = new RaceEngine(cfg).run();
    for (const row of result.rows) {
      expect(row.tyreStops).toBeGreaterThanOrEqual(1);
    }
  });

  it("a faster (pace-heavy) driver qualifies ahead of a slow one", () => {
    const fast = makeDriver({
      name: "Fast",
      country: "X",
      kind: "human",
      skills: { ...emptySkills(), pace: 8 },
      startingTyre: "soft",
    });
    const slow = makeDriver({
      name: "Slow",
      country: "X",
      kind: "human",
      skills: { ...emptySkills(), pace: 0 },
      startingTyre: "soft",
    });
    const t0 = baseLapTime(redBullRing());
    const q = runQualifying([fast, slow], t0, mulberry32(1));
    const f = q.find((r) => r.driverId === fast.id)!;
    const s = q.find((r) => r.driverId === slow.id)!;
    expect(f.gridPosition).toBeLessThan(s.gridPosition);
  });

  it("emits overtake, pit and finish events", () => {
    const track = redBullRing();
    const drivers = gridFrom(field(5), 5);
    const cfg = buildRaceConfig({ track, drivers, totalLaps: 12, seed: 7, dt: 0.1 });
    const result = new RaceEngine(cfg).run();
    const types = new Set(result.events.map((e) => e.type));
    expect(types.has("overtake")).toBe(true);
    expect(types.has("pit_stop")).toBe(true);
    expect(result.events.filter((e) => e.type === "finish")).toHaveLength(drivers.length);
  });
});
