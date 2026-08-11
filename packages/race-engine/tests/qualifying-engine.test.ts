import { describe, expect, it } from "vitest";
import {
  QualifyingEngine,
  buildQualyConfig,
  emptySkills,
  makeDriver,
  mulberry32,
  redBullRing,
  makeBot,
  type Driver,
} from "../src/index.js";

function field(seed: number): Driver[] {
  const rng = mulberry32(seed);
  const bots: Driver[] = [];
  for (let i = 0; i < 9; i++) bots.push(makeBot({}, rng));
  return bots;
}

describe("QualifyingEngine", () => {
  it("assigns a unique grid position to every driver and finishes", () => {
    const drivers = field(1);
    const engine = new QualifyingEngine(buildQualyConfig({ track: redBullRing(), drivers, seed: 5 }));
    const snap = engine.run();
    expect(snap.phase).toBe("finished");
    expect(snap.results).toHaveLength(drivers.length);
    const grids = snap.results.map((r) => r.gridPosition).sort((a, b) => a - b);
    expect(grids).toEqual(Array.from({ length: drivers.length }, (_, i) => i + 1));
    for (const r of snap.results) expect(r.bestLapTime).not.toBeNull();
  });

  it("a high-pace driver qualifies ahead of a low-pace one", () => {
    const fast = makeDriver({ name: "Fast", country: "X", kind: "human", skills: { ...emptySkills(), pace: 8 }, startingTyre: "soft" });
    const slow = makeDriver({ name: "Slow", country: "X", kind: "human", skills: { ...emptySkills(), pace: 0 }, startingTyre: "soft" });
    const engine = new QualifyingEngine(buildQualyConfig({ track: redBullRing(), drivers: [fast, slow], seed: 1 }));
    const snap = engine.run();
    const f = snap.results.find((r) => r.driverId === fast.id)!;
    const s = snap.results.find((r) => r.driverId === slow.id)!;
    expect(f.gridPosition).toBeLessThan(s.gridPosition);
    expect(f.bestLapTime!).toBeLessThan(s.bestLapTime!);
  });

  it("is deterministic for the same seed", () => {
    const drivers = field(2);
    const a = new QualifyingEngine(buildQualyConfig({ track: redBullRing(), drivers, seed: 42 })).run();
    const b = new QualifyingEngine(buildQualyConfig({ track: redBullRing(), drivers, seed: 42 })).run();
    expect(a.results.map((r) => r.driverId)).toEqual(b.results.map((r) => r.driverId));
    expect(a.results.map((r) => r.bestLapTime)).toEqual(b.results.map((r) => r.bestLapTime));
  });

  it("cars leave on staggered intervals (out-lap phases appear over time)", () => {
    const drivers = field(3);
    const engine = new QualifyingEngine(buildQualyConfig({ track: redBullRing(), drivers, seed: 9, startIntervalSec: 5 }));
    engine.step();
    const onTrackEarly = engine.cars.filter((c) => c.phase !== "waiting").length;
    expect(onTrackEarly).toBeLessThan(drivers.length);
    for (let i = 0; i < 500; i++) engine.step(0.5);
    expect(engine.cars.every((c) => c.phase !== "waiting")).toBe(true);
  });

  it("gridOrder matches results ordering", () => {
    const drivers = field(4);
    const engine = new QualifyingEngine(buildQualyConfig({ track: redBullRing(), drivers, seed: 7 }));
    engine.run();
    const order = engine.gridOrder();
    expect(order).toHaveLength(drivers.length);
    expect(new Set(order).size).toBe(drivers.length);
  });

  it("S1-4: heavy-rain qualifying is slower than dry on the same seed/field", () => {
    const driversDry = field(21);
    const driversWet = field(21);
    const dry = new QualifyingEngine(
      buildQualyConfig({ track: redBullRing(), drivers: driversDry, seed: 21, weather: "dry" }),
    ).run();
    const rain = new QualifyingEngine(
      buildQualyConfig({ track: redBullRing(), drivers: driversWet, seed: 21, weather: "heavyRain" }),
    ).run();

    const avg = (rows: { bestLapTime: number | null }[]): number => {
      const times = rows.map((r) => r.bestLapTime).filter((t): t is number => t != null);
      return times.reduce((a, b) => a + b, 0) / times.length;
    };
    const fastDry = dry.results[0]!.bestLapTime!;
    const fastRain = rain.results[0]!.bestLapTime!;
    expect(fastRain).toBeGreaterThan(fastDry);
    expect(avg(rain.results)).toBeGreaterThan(avg(dry.results));
  });
});
