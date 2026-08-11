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
  trackLengthM,
  type Driver,
} from "../src/index.js";

function heroDriver(): Driver {
  return makeDriver({
    name: "Hero",
    country: "RU",
    kind: "human",
    skills: { ...emptySkills(), pace: 6 },
    startingTyre: "medium",
    pitPlan: { targetStops: 1, strategy: "flexible", compound: "soft" },
  });
}

describe("S0-5: DSQ / 30s-penalty info events", () => {
  it("emits a дисквалификация info event when a car never pits", () => {
    const hero = heroDriver();
    const bot = makeBot({}, mulberry32(1));
    const cfg = buildRaceConfig({
      track: redBullRing(),
      drivers: [hero, bot],
      totalLaps: 6,
      seed: 5,
      dt: 0.1,
      heroId: hero.id,
    });
    const engine = new RaceEngine(cfg);
    const result = engine.run();
    const dsqInfo = result.events.find(
      (e) => e.type === "info" && e.message.includes("дисквалификация"),
    );
    expect(dsqInfo).toBeTruthy();
    expect(dsqInfo!.type === "info" && dsqInfo.message.includes("Hero")).toBe(true);
  });

  it("emits a штраф 30с info event when a car pits without changing compound", () => {
    const hero = makeDriver({
      name: "Hero",
      country: "RU",
      kind: "human",
      skills: { ...emptySkills(), pace: 6 },
      startingTyre: "medium",
      pitPlan: { targetStops: 1, strategy: "flexible", compound: "medium" },
    });
    const bot = makeBot({}, mulberry32(3));
    const cfg = buildRaceConfig({
      track: redBullRing(),
      drivers: [hero, bot],
      totalLaps: 6,
      seed: 9,
      dt: 0.1,
      heroId: hero.id,
    });
    const engine = new RaceEngine(cfg);
    engine.requestPit(hero.id, "medium");
    const result = engine.run();
    const heroRow = result.rows.find((r) => r.driverId === hero.id)!;
    expect(heroRow.tyreStops).toBeGreaterThanOrEqual(1);
    const penaltyInfo = result.events.find(
      (e) => e.type === "info" && e.message.includes("штраф 30с"),
    );
    expect(penaltyInfo).toBeTruthy();
  });
});

describe("S0-6: positionsGained from post-penalty place", () => {
  it("a same-compound 30s penalty drops positionsGained to reflect final place", () => {
    const track = redBullRing();
    const length = trackLengthM(track);
    const totalLaps = 4;
    const hero = makeDriver({
      name: "Hero",
      country: "RU",
      kind: "human",
      skills: { ...emptySkills(), pace: 6 },
      startingTyre: "medium",
      pitPlan: { targetStops: 1, compound: "medium" },
    });
    const botA = makeBot({}, mulberry32(11));
    const botB = makeBot({}, mulberry32(22));
    const cfg = buildRaceConfig({
      track,
      drivers: [botA, botB, hero],
      totalLaps,
      seed: 1,
      dt: 0.1,
      heroId: hero.id,
    });
    const engine = new RaceEngine(cfg);

    const heroCar = engine.cars.find((c) => c.driverId === hero.id)!;
    const aCar = engine.cars.find((c) => c.driverId === botA.id)!;
    const bCar = engine.cars.find((c) => c.driverId === botB.id)!;
    const finishLine = totalLaps * length;

    heroCar.s = heroCar.initialS + finishLine;
    heroCar.raceTime = 200;
    heroCar.finishTime = 200;
    heroCar.finished = true;
    heroCar.tyreStops = 1;
    heroCar.compoundChanged = false;
    heroCar.penaltySec = 0;
    heroCar.dnf = false;

    aCar.s = aCar.initialS + finishLine;
    aCar.raceTime = 210;
    aCar.finishTime = 210;
    aCar.finished = true;
    aCar.tyreStops = 1;
    aCar.compoundChanged = true;
    aCar.penaltySec = 0;
    aCar.dnf = false;

    bCar.s = bCar.initialS + finishLine;
    bCar.raceTime = 220;
    bCar.finishTime = 220;
    bCar.finished = true;
    bCar.tyreStops = 1;
    bCar.compoundChanged = true;
    bCar.penaltySec = 0;
    bCar.dnf = false;

    const result = engine.result();
    const heroRow = result.rows.find((r) => r.driverId === hero.id)!;
    expect(heroRow.gridPosition).toBe(3);
    expect(heroRow.place).toBe(3);
    expect(heroRow.positionsGained).toBe(0);
    expect(heroRow.raceTime).toBe(230);
  });
});

describe("S0-7: mechanical DNF restricted to bots", () => {
  it("hero never DNFs from mechanical failure even at 100% failure rate", () => {
    const failureCfg = CONFIG.mechanicalFailure as { basePerLap: number };
    const orig = failureCfg.basePerLap;
    failureCfg.basePerLap = 1.0;
    try {
      const hero = heroDriver();
      const bot = makeBot({}, mulberry32(7));
      const cfg = buildRaceConfig({
        track: redBullRing(),
        drivers: [hero, bot],
        totalLaps: 4,
        seed: 42,
        dt: 0.1,
        heroId: hero.id,
      });
      const engine = new RaceEngine(cfg);
      engine.run();
      const heroCar = engine.cars.find((c) => c.driverId === hero.id)!;
      expect(heroCar.dnf).toBe(false);
      expect(heroCar.finished).toBe(true);
      const botCar = engine.cars.find((c) => c.driverId === bot.id)!;
      expect(botCar.dnf).toBe(true);
    } finally {
      failureCfg.basePerLap = orig;
    }
  });
});

describe("S1-8b: snapshot surfaces last-lap and best-lap times", () => {
  it("cars carry lastLapTime and bestLapTime fields", () => {
    const hero = heroDriver();
    const bot = makeBot({}, mulberry32(13));
    const cfg = buildRaceConfig({
      track: redBullRing(),
      drivers: [hero, bot],
      totalLaps: 4,
      seed: 77,
      dt: 0.1,
      heroId: hero.id,
    });
    const engine = new RaceEngine(cfg);
    engine.step();
    const snap = engine.snapshot();
    for (const c of snap.cars) {
      expect(c).toHaveProperty("lastLapTime");
      expect(c).toHaveProperty("bestLapTime");
      expect(c.lastLapTime).toBeNull();
      expect(c.bestLapTime).toBeNull();
    }
  });

  it("hero lastLapTime is a positive finite number after completing a lap", () => {
    const hero = heroDriver();
    const bot = makeBot({}, mulberry32(99));
    const cfg = buildRaceConfig({
      track: redBullRing(),
      drivers: [hero, bot],
      totalLaps: 4,
      seed: 88,
      dt: 0.1,
      heroId: hero.id,
    });
    const engine = new RaceEngine(cfg);
    for (let i = 0; i < 50_000 && engine.cars.find((c) => c.driverId === hero.id)!.lap < 1; i++) {
      engine.step();
    }
    const snap = engine.snapshot();
    const hc = snap.cars.find((c) => c.driverId === hero.id)!;
    expect(hc.lastLapTime).not.toBeNull();
    expect(Number.isFinite(hc.lastLapTime)).toBe(true);
    expect(hc.lastLapTime!).toBeGreaterThan(0);
    expect(hc.bestLapTime).not.toBeNull();
    expect(Number.isFinite(hc.bestLapTime)).toBe(true);
    expect(hc.bestLapTime!).toBeGreaterThan(0);
  });
});
