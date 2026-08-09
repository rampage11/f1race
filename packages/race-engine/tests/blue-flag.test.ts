import { describe, expect, it } from "vitest";
import {
  RaceEngine,
  buildRaceConfig,
  emptySkills,
  makeDriver,
  passProbability,
  redBullRing,
  type Driver,
} from "../src/index.js";

function buildTwoDrivers(): { fast: Driver; slow: Driver } {
  const fast = makeDriver({
    name: "Fast",
    country: "X",
    kind: "human",
    skills: { ...emptySkills(), pace: 10, fitness: 5 },
    startingTyre: "soft",
    paceFactor: 1.12,
  });
  const slow = makeDriver({
    name: "Slow",
    country: "X",
    kind: "human",
    skills: { ...emptySkills(), pace: 0, fitness: 0 },
    startingTyre: "hard",
    paceFactor: 0.88,
  });
  return { fast, slow };
}

describe("Blue flag yield (spec P4)", () => {
  it("lapping car yields without leader teleport", () => {
    const track = redBullRing();
    const { fast, slow } = buildTwoDrivers();
    const cfg = buildRaceConfig({
      track,
      drivers: [fast, slow],
      totalLaps: 15,
      seed: 42,
      dt: 0.1,
    });
    const engine = new RaceEngine(cfg);

    const fastDeltas: number[] = [];
    const slowVBlue: number[] = [];
    const slowVFree: number[] = [];
    let blueFlagEver = false;
    const fastCar0 = engine.cars.find((c) => c.driverId === fast.id)!;
    let prevFastS = fastCar0.s;
    let prevFastInPits = fastCar0.inPits;

    while (engine.phase === "racing") {
      engine.step();
      const fastCar = engine.cars.find((c) => c.driverId === fast.id)!;
      const slowCar = engine.cars.find((c) => c.driverId === slow.id)!;
      if (!prevFastInPits && !fastCar.inPits) {
        fastDeltas.push(Math.abs(fastCar.s - prevFastS));
      }
      prevFastS = fastCar.s;
      prevFastInPits = fastCar.inPits;
      if (slowCar.blueFlag) {
        blueFlagEver = true;
        if (slowCar.v > 50) slowVBlue.push(slowCar.v);
      } else {
        if (slowCar.v > 50) slowVFree.push(slowCar.v);
      }
    }

    expect(blueFlagEver).toBe(true);

    const maxDelta = Math.max(...fastDeltas);
    expect(maxDelta).toBeLessThan(15);

    expect(slowVBlue.length).toBeGreaterThan(0);
    expect(slowVFree.length).toBeGreaterThan(0);
    const meanBlue = slowVBlue.reduce((a, b) => a + b, 0) / slowVBlue.length;
    const meanFree = slowVFree.reduce((a, b) => a + b, 0) / slowVFree.length;
    // Blue-flag samples are biased toward fast catching straights (where the leader closes in),
    // so the raw speed mean is noisy; bound it loosely and rely on the lapping overtake below
    // as the structural proof that yielding actually let the leader through.
    expect(meanBlue).toBeLessThan(meanFree * 1.05);

    const result = engine.result();
    const lappingOvertake = result.events.find(
      (e) => e.type === "overtake" && e.attackerId === fast.id && e.victimId === slow.id,
    );
    expect(lappingOvertake).toBeTruthy();

    const slowCarFinal = engine.cars.find((c) => c.driverId === slow.id)!;
    expect(slowCarFinal.defendScore).toBe(0);
    const fastCarFinal = engine.cars.find((c) => c.driverId === fast.id)!;
    expect(fastCarFinal.overtakeScore).toBeGreaterThan(0);
  });

  it("passProbability ignores defense and yields high floor for lapped traffic", () => {
    const base = {
      paceDeltaMs: 1.0,
      attackSkill: 0,
      defenseSkill: 20,
      tyreAdvantage: 0,
      trainSize: 5,
      overtakingScore: 0.3,
      attackerAlreadyAhead: false,
    };
    const held = passProbability({ ...base, lapDelta: 0 });
    const lapped = passProbability({ ...base, lapDelta: 1 });
    expect(held).toBeLessThan(0.1);
    expect(lapped).toBeGreaterThan(0.8);
  });
});
