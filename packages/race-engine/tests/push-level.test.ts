import { describe, expect, it } from "vitest";
import {
  CONFIG,
  RaceEngine,
  buildRaceConfig,
  emptySkills,
  makeBot,
  makeDriver,
  mulberry32,
  pushLevelFor,
  pushWearFor,
  redBullRing,
  type Driver,
  type PushStrategy,
} from "../src/index.js";

function heroEngine(opts?: { laps?: number; seed?: number }): { engine: RaceEngine; heroId: string } {
  const track = redBullRing();
  const hero = makeDriver({
    name: "Hero",
    country: "RU",
    kind: "human",
    skills: { ...emptySkills(), pace: 6, fitness: 4, tyreMgmt: 2 },
    startingTyre: "medium",
    pitPlan: { targetStops: 1, compound: "soft" },
  });
  const bot = makeBot({}, mulberry32(99));
  const cfg = buildRaceConfig({
    track,
    drivers: [hero, bot],
    totalLaps: opts?.laps ?? 8,
    seed: opts?.seed ?? 5,
    dt: 0.1,
    heroId: hero.id,
  });
  return { engine: new RaceEngine(cfg), heroId: hero.id };
}

function buildHero(strategy: PushStrategy | "none", seed: number): { engine: RaceEngine; heroId: string } {
  const track = redBullRing();
  const hero = makeDriver({
    name: "Hero",
    country: "RU",
    kind: "human",
    skills: { ...emptySkills(), pace: 6, fitness: 4, tyreMgmt: 2 },
    startingTyre: "medium",
    pitPlan: { targetStops: 1, compound: "soft" },
  });
  const bot = makeBot({}, mulberry32(99));
  const cfg = buildRaceConfig({ track, drivers: [hero, bot], totalLaps: 8, seed, dt: 0.1, heroId: hero.id });
  const engine = new RaceEngine(cfg);
  if (strategy !== "none") engine.requestPushLevel(hero.id, strategy);
  return { engine, heroId: hero.id };
}

describe("requestPushLevel", () => {
  it("sets car.pushLevel via pushLevelFor and stores the strategy on the car", () => {
    const { engine, heroId } = heroEngine();
    expect(engine.requestPushLevel(heroId, "attack")).toBe("set");
    const car = engine.cars.find((c) => c.driverId === heroId)!;
    expect(car.pushLevel).toBe(pushLevelFor("attack"));
    expect(car.pushStrategy).toBe("attack");

    expect(engine.requestPushLevel(heroId, "conservative")).toBe("set");
    expect(engine.cars.find((c) => c.driverId === heroId)!.pushLevel).toBe(pushLevelFor("conservative"));
    expect(engine.cars.find((c) => c.driverId === heroId)!.pushStrategy).toBe("conservative");
  });

  it("unknown driver is rejected", () => {
    const { engine } = heroEngine();
    expect(engine.requestPushLevel("nonexistent", "attack")).toBe("rejected_unknown_driver");
  });

  it("not racing is rejected once the race finishes", () => {
    const { engine, heroId } = heroEngine({ laps: 4 });
    engine.run();
    expect(engine.phase).toBe("finished");
    expect(engine.requestPushLevel(heroId, "attack")).toBe("rejected_not_racing");
  });

  it("defaults to balanced at race start", () => {
    const { engine, heroId } = heroEngine();
    const car = engine.cars.find((c) => c.driverId === heroId)!;
    expect(car.pushStrategy).toBe("balanced");
    expect(car.pushLevel).toBe(pushLevelFor("balanced"));
  });
});

describe("push strategy effects over a stint", () => {
  function runStint(strategy: PushStrategy): { bestLap: number; wear: number; laps: number } {
    const { engine, heroId } = buildHero(strategy, 5);
    const heroCar = engine.cars.find((c) => c.driverId === heroId)!;
    let guard = 0;
    while (heroCar.lap < 3 && guard < 8000) {
      engine.step();
      guard++;
    }
    expect(heroCar.bestLapTime).not.toBeNull();
    return { bestLap: heroCar.bestLapTime!, wear: heroCar.tyre.wear, laps: heroCar.lap };
  }

  it("attack yields faster laps + higher wear than conservative over a stint", () => {
    const attack = runStint("attack");
    const balanced = runStint("balanced");
    const conservative = runStint("conservative");
    expect(attack.laps).toBeGreaterThanOrEqual(3);
    expect(conservative.laps).toBeGreaterThanOrEqual(3);

    expect(attack.bestLap).toBeLessThan(balanced.bestLap);
    expect(balanced.bestLap).toBeLessThan(conservative.bestLap);

    expect(attack.wear).toBeGreaterThan(balanced.wear);
    expect(balanced.wear).toBeGreaterThan(conservative.wear);
  });

  it("per-lap wear scaling follows pushWearFor(strategy)", () => {
    expect(pushWearFor("attack")).toBeGreaterThan(pushWearFor("balanced"));
    expect(pushWearFor("conservative")).toBeLessThan(pushWearFor("balanced"));
  });
});

describe("push strategy snapshot", () => {
  it("pushStrategy appears in the snapshot and reflects the chosen mode", () => {
    const { engine, heroId } = heroEngine();
    engine.requestPushLevel(heroId, "attack");
    const hc = engine.snapshot().cars.find((c) => c.driverId === heroId)!;
    expect(hc.pushStrategy).toBe("attack");
  });

  it("snapshot defaults to balanced before any request", () => {
    const { engine, heroId } = heroEngine();
    const hc = engine.snapshot().cars.find((c) => c.driverId === heroId)!;
    expect(hc.pushStrategy).toBe("balanced");
  });
});

describe("push strategy reset on fresh-tyre pit exit", () => {
  function humanPit(): Driver {
    return makeDriver({
      name: "Hero",
      country: "RU",
      kind: "human",
      skills: { ...emptySkills(), pace: 4 },
      startingTyre: "medium",
      pitPlan: { targetStops: 1, strategy: "flexible", compound: "soft" },
    });
  }

  it("fresh-tyre pit exit resets pushLevel/pushStrategy to balanced", () => {
    const hero = humanPit();
    const cfg = buildRaceConfig({ track: redBullRing(), drivers: [hero, makeBot({}, mulberry32(2))], totalLaps: 8, seed: 11, dt: 0.1 });
    const engine = new RaceEngine(cfg);
    const car = engine.cars.find((c) => c.driverId === hero.id)!;
    car.lap = 2;
    car.s = redBullRing().pitEntryS - 2;
    car.v = 50;
    engine.requestPushLevel(hero.id, "attack");
    expect(car.pushStrategy).toBe("attack");
    engine.requestPit(hero.id, "soft");
    let guard = 0;
    while (!car.inPits && guard < 200) {
      engine.step();
      guard++;
    }
    expect(car.inPits).toBe(true);
    expect(car.pushStrategy).toBe("attack");
    guard = 0;
    while (car.inPits && guard < 600) {
      engine.step();
      guard++;
    }
    expect(car.inPits).toBe(false);
    expect(car.pushStrategy).toBe("balanced");
    expect(car.pushLevel).toBe(pushLevelFor("balanced"));
  });
});
