import { describe, expect, it } from "vitest";
import {
  RaceEngine,
  buildRaceConfig,
  emptySkills,
  makeDriver,
  paceSpeedMultiplier,
  redBullRing,
  freshTyre,
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

describe("slipstream (tow)", () => {
  it("tow applies when close behind another car on a straight", () => {
    const { engine, a, b } = twoCarEngine();
    for (let i = 0; i < 10; i++) engine.step();
    const carA = engine.cars.find((c) => c.driverId === a)!;
    const carB = engine.cars.find((c) => c.driverId === b)!;
    // Place the pair on the first straight segment (robust to track re-anchoring).
    const t = redBullRing();
    let acc = 0;
    let straightS = -1;
    for (const seg of t.segments) {
      if (seg.kind === "straight") {
        straightS = acc + Math.floor(seg.length / 2);
        break;
      }
      acc += seg.length;
    }
    expect(straightS).toBeGreaterThanOrEqual(0);
    carA.initialS = 0;
    carA.s = straightS;
    carA.v = 70;
    carA.lap = 2;
    carB.initialS = 0;
    carB.s = straightS + 20;
    carB.v = 70;
    carB.lap = 2;
    engine.step();
    expect(carA.tow).toBe(true);
  });

  it("tow does NOT apply in a corner (overtaking below threshold)", () => {
    const { engine, a, b } = twoCarEngine();
    for (let i = 0; i < 10; i++) engine.step();
    const carA = engine.cars.find((c) => c.driverId === a)!;
    const carB = engine.cars.find((c) => c.driverId === b)!;
    // Place the pair on a corner (overtaking below the tow threshold) — robust to
    // track re-anchoring. Corners always carry overtaking < slipstream.minOvertakingScore.
    const t = redBullRing();
    let acc = 0;
    let cornerS = -1;
    for (const seg of t.segments) {
      if (seg.kind === "corner") {
        cornerS = acc + Math.floor(seg.length / 2);
        break;
      }
      acc += seg.length;
    }
    expect(cornerS).toBeGreaterThanOrEqual(0);
    carA.initialS = 0;
    carA.s = cornerS;
    carA.v = 30;
    carA.lap = 2;
    carB.initialS = 0;
    carB.s = cornerS + 20;
    carB.v = 30;
    carB.lap = 2;
    engine.step();
    expect(carA.tow).toBe(false);
  });

  it("tow grants a small pace bonus via paceSpeedMultiplier", () => {
    const base = {
      paceSkill: 4,
      fitnessSkill: 10,
      fatigue01: 0,
      pushLevel: 1,
      tyre: freshTyre("medium"),
      t0: 63,
      noise: 0,
      weather: "dry" as const,
    };
    const without = paceSpeedMultiplier(base);
    const withTow = paceSpeedMultiplier({ ...base, towBonusSec: 0.25 });
    expect(withTow).toBeGreaterThan(without);
  });
});
