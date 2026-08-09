import { describe, expect, it } from "vitest";
import {
  CONFIG,
  RaceEngine,
  buildRaceConfig,
  emptySkills,
  makeDriver,
  passProbability,
  redBullRing,
} from "../src/index.js";

function twoCarEngine(seed = 5): { engine: RaceEngine; a: string; b: string } {
  const a = makeDriver({
    name: "A",
    country: "X",
    kind: "human",
    skills: { ...emptySkills(), pace: 6 },
    startingTyre: "soft",
  });
  const b = makeDriver({
    name: "B",
    country: "X",
    kind: "human",
    skills: { ...emptySkills(), pace: 0 },
    startingTyre: "medium",
  });
  const cfg = buildRaceConfig({ track: redBullRing(), drivers: [a, b], totalLaps: 8, seed, dt: 0.1 });
  return { engine: new RaceEngine(cfg), a: a.id, b: b.id };
}

describe("DRS activation", () => {
  it("a car within drsGapSec in a drsZone gets drsActiveUntil set", () => {
    const { engine, a, b } = twoCarEngine();
    for (let i = 0; i < 10; i++) engine.step();
    const carA = engine.cars.find((c) => c.driverId === a)!;
    const carB = engine.cars.find((c) => c.driverId === b)!;
    // Place the pair INSIDE the first DRS zone (robust to track re-anchoring).
    const zone = redBullRing().drsZones[0]!;
    const base = Math.round(zone.startS + (zone.endS - zone.startS) * 0.25);
    carA.initialS = 0;
    carA.s = base;
    carA.v = 70;
    carA.lap = 2;
    carB.initialS = 0;
    carB.s = base + 20;
    carB.v = 70;
    carB.lap = 2;
    engine.step();
    expect(carA.drsActiveUntil).toBeGreaterThan(engine.time);
  });

  it("a car outside any drsZone does not activate DRS", () => {
    const { engine, a, b } = twoCarEngine();
    for (let i = 0; i < 10; i++) engine.step();
    const carA = engine.cars.find((c) => c.driverId === a)!;
    const carB = engine.cars.find((c) => c.driverId === b)!;
    const t = redBullRing();
    // Find an s-coordinate OUTSIDE every DRS zone (robust to track re-anchoring).
    let mid = Math.round(t.lengthM * 0.5);
    while (t.drsZones.some((z) => mid >= z.startS && mid <= z.endS)) mid = (mid + 37) % t.lengthM;
    carA.initialS = 0;
    carA.s = mid;
    carA.v = 70;
    carA.lap = 2;
    carA.drsActiveUntil = 0;
    carB.initialS = 0;
    carB.s = mid + 10;
    carB.v = 70;
    carB.lap = 2;
    const before = engine.time;
    engine.step();
    void before;
    expect(carA.drsActiveUntil).toBe(0);
  });

  it("passProbability includes the DRS bonus when the attacker has DRS", () => {
    const base = {
      paceDeltaMs: 3,
      attackSkill: 5,
      defenseSkill: 5,
      tyreAdvantage: 0,
      trainSize: 0,
      overtakingScore: 0.8,
      attackerAlreadyAhead: false,
      lapDelta: 0,
    };
    const without = passProbability(base);
    const withDrs = passProbability({ ...base, attackerDrsActive: true });
    expect(withDrs).toBeGreaterThan(without);
    expect(withDrs).toBeCloseTo(without * CONFIG.battle.drsPassMultiplier, 6);
  });
});
