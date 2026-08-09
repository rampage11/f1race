import { describe, expect, it } from "vitest";
import {
  CONFIG,
  RaceEngine,
  buildRaceConfig,
  emptySkills,
  makeBot,
  makeDriver,
  mulberry32,
  redBullRing,
  type Driver,
} from "../src/index.js";

function human(): Driver {
  return makeDriver({
    name: "Hero",
    country: "RU",
    kind: "human",
    skills: { ...emptySkills(), pace: 4 },
    startingTyre: "medium",
    pitPlan: { targetStops: 1, strategy: "flexible", compound: "soft" },
  });
}

function engine(drivers: Driver[], seed = 7): RaceEngine {
  const cfg = buildRaceConfig({ track: redBullRing(), drivers, totalLaps: 8, seed, dt: 0.1 });
  return new RaceEngine(cfg);
}

describe("pit control (humans vs bots)", () => {
  it("a human does NOT auto-pit on worn tyres / strategic window without an explicit request", () => {
    const hero = human();
    const eng = engine([hero, makeBot({}, mulberry32(1))], 7);
    const car = eng.cars.find((c) => c.driverId === hero.id)!;
    // Force the conditions that would normally trigger an auto-pit: worn rubber, lap 2 (needStop
    // still true), parked right at the pit entry so proximity isn't the blocker.
    car.lap = 2;
    car.tyre.wear = CONFIG.tyres.medium.cliff; // past the wear threshold
    car.s = CONFIG.physics.gridSpacingM; // near s=0; move just before the pit entry
    const track = redBullRing();
    car.s = track.pitEntryS - 2;
    car.v = 50;
    for (let i = 0; i < 40; i++) eng.step();
    expect(car.inPits).toBe(false);
  });

  it("a human pits when the player explicitly requests it (and is near the entry)", () => {
    const hero = human();
    const eng = engine([hero, makeBot({}, mulberry32(2))], 11);
    const car = eng.cars.find((c) => c.driverId === hero.id)!;
    car.lap = 2;
    car.s = redBullRing().pitEntryS - 2;
    car.v = 50;
    eng.requestPit(hero.id, "soft");
    for (let i = 0; i < 40; i++) eng.step();
    expect(car.inPits).toBe(true);
  });
});
