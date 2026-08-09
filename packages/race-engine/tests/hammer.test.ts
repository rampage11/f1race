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
} from "../src/index.js";

function heroEngine(opts?: { laps?: number; seed?: number }): { engine: RaceEngine; heroId: string } {
  const track = redBullRing();
  const hero = makeDriver({
    name: "Hero",
    country: "RU",
    kind: "human",
    skills: { ...emptySkills(), pace: 6, fitness: 4 },
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

describe("Hammer Time activation", () => {
  it("activates from a clean state on lap >= 2", () => {
    const { engine, heroId } = heroEngine();
    const car = engine.cars.find((c) => c.driverId === heroId)!;
    car.lap = 2;
    expect(engine.requestHammer(heroId)).toBe("activated");
    const after = engine.cars.find((c) => c.driverId === heroId)!;
    expect(after.hammerActiveUntil).toBeCloseTo(engine.time + CONFIG.HAMMER_TIME.durationSec, 5);
    expect(after.hammerReadyAt).toBeCloseTo(
      engine.time + CONFIG.HAMMER_TIME.durationSec + CONFIG.HAMMER_TIME.cooldownSec,
      5,
    );
  });

  it("cooldown blocks re-activation", () => {
    const { engine, heroId } = heroEngine();
    engine.cars.find((c) => c.driverId === heroId)!.lap = 2;
    expect(engine.requestHammer(heroId)).toBe("activated");
    expect(engine.requestHammer(heroId)).toBe("rejected_cooldown");
  });

  it("first-lap lock blocks activation on lap 1", () => {
    const { engine, heroId } = heroEngine();
    engine.cars.find((c) => c.driverId === heroId)!.lap = 1;
    expect(engine.requestHammer(heroId)).toBe("rejected_first_lap");
  });

  it("pit blocks activation", () => {
    const { engine, heroId } = heroEngine();
    const car = engine.cars.find((c) => c.driverId === heroId)!;
    car.lap = 2;
    car.inPits = true;
    expect(engine.requestHammer(heroId)).toBe("rejected_pit");
  });

  it("tyre wear >= minTyreWearToActivate blocks activation", () => {
    const { engine, heroId } = heroEngine();
    const car = engine.cars.find((c) => c.driverId === heroId)!;
    car.lap = 2;
    car.tyre.wear = CONFIG.HAMMER_TIME.minTyreWearToActivate + 0.01;
    expect(engine.requestHammer(heroId)).toBe("rejected_tyre_wear");
  });

  it("unknown driver is rejected", () => {
    const { engine } = heroEngine();
    expect(engine.requestHammer("nonexistent")).toBe("rejected_unknown_driver");
  });

  it("not racing is rejected once the race finishes", () => {
    const { engine, heroId } = heroEngine({ laps: 4 });
    engine.run();
    expect(engine.phase).toBe("finished");
    expect(engine.requestHammer(heroId)).toBe("rejected_not_racing");
  });
});

describe("Hammer Time snapshot", () => {
  it("hammerTime fields are populated while active", () => {
    const { engine, heroId } = heroEngine();
    engine.cars.find((c) => c.driverId === heroId)!.lap = 2;
    engine.requestHammer(heroId);
    const snap = engine.snapshot();
    const hc = snap.cars.find((c) => c.driverId === heroId)!;
    expect(hc.hammerTime.active).toBe(true);
    expect(hc.hammerTime.remainingSec).toBeGreaterThan(0);
    expect(hc.hammerTime.remainingSec).toBeCloseTo(CONFIG.HAMMER_TIME.durationSec, 1);
    expect(hc.hammerTime.cooldownSec).toBe(CONFIG.HAMMER_TIME.cooldownSec);
    expect(hc.hammerTime.readyAt).toBeGreaterThan(engine.time);
  });

  it("expires after durationSec (active becomes false)", () => {
    const { engine, heroId } = heroEngine();
    const car = engine.cars.find((c) => c.driverId === heroId)!;
    car.lap = 2;
    engine.requestHammer(heroId);
    const target = engine.time + CONFIG.HAMMER_TIME.durationSec + 0.5;
    for (let i = 0; i < 500 && engine.time < target; i++) engine.step();
    const snap = engine.snapshot();
    const hc = snap.cars.find((c) => c.driverId === heroId)!;
    expect(hc.hammerTime.active).toBe(false);
  });

  it("reports remaining cooldown after the boost expires", () => {
    const { engine, heroId } = heroEngine();
    engine.cars.find((c) => c.driverId === heroId)!.lap = 2;
    engine.requestHammer(heroId);
    const pastBoost = engine.time + CONFIG.HAMMER_TIME.durationSec + 0.2;
    for (let i = 0; i < 500 && engine.time < pastBoost; i++) engine.step();
    const hc = engine.snapshot().cars.find((c) => c.driverId === heroId)!;
    expect(hc.hammerTime.active).toBe(false);
    expect(hc.hammerTime.remainingSec).toBeGreaterThan(0);
    expect(hc.hammerTime.readyAt).toBeGreaterThan(engine.time);
  });
});

describe("Hammer Time modifiers", () => {
  it("cornering multiplier lets the active car carry more speed through a corner", () => {
    const makeEng = (): { engine: RaceEngine; heroId: string } => {
      const track = redBullRing();
      const hero = makeDriver({
        name: "Hero",
        country: "RU",
        kind: "human",
        skills: { ...emptySkills(), pace: 6, fitness: 4 },
        startingTyre: "medium",
        pitPlan: { targetStops: 1, compound: "soft" },
      });
      const bot = makeBot({}, mulberry32(7));
      const cfg = buildRaceConfig({ track, drivers: [hero, bot], totalLaps: 8, seed: 200, dt: 0.1, heroId: hero.id });
      return { engine: new RaceEngine(cfg), heroId: hero.id };
    };
    const base = makeEng();
    const boosted = makeEng();
    for (let i = 0; i < 10; i++) {
      base.engine.step();
      boosted.engine.step();
    }
    const len = trackLengthM(redBullRing());
    const place = (e: { engine: RaceEngine; heroId: string }) => {
      const c = e.engine.cars.find((x) => x.driverId === e.heroId)!;
      c.initialS = 0;
      c.s = 3000;
      c.v = 46;
      c.lap = 2;
    };
    place(base);
    place(boosted);
    expect(boosted.engine.requestHammer(boosted.heroId)).toBe("activated");
    for (let i = 0; i < 30; i++) {
      base.engine.step();
      boosted.engine.step();
    }
    const b = base.engine.cars.find((c) => c.driverId === base.heroId)!;
    const f = boosted.engine.cars.find((c) => c.driverId === boosted.heroId)!;
    expect(f.s).toBeGreaterThan(b.s);
  });

  it("tyre wear is multiplied while hammer is active during a lap", () => {
    const makeEng = (): { engine: RaceEngine; heroId: string } => {
      const track = redBullRing();
      const hero = makeDriver({
        name: "Hero",
        country: "RU",
        kind: "human",
        skills: { ...emptySkills(), pace: 6 },
        startingTyre: "medium",
        pitPlan: { targetStops: 1, compound: "soft" },
      });
      const bot = makeBot({}, mulberry32(3));
      const cfg = buildRaceConfig({ track, drivers: [hero, bot], totalLaps: 8, seed: 311, dt: 0.1, heroId: hero.id });
      return { engine: new RaceEngine(cfg), heroId: hero.id };
    };
    const base = makeEng();
    const boosted = makeEng();
    for (let i = 0; i < 10; i++) {
      base.engine.step();
      boosted.engine.step();
    }
    const len = trackLengthM(redBullRing());
    const place = (e: { engine: RaceEngine; heroId: string }) => {
      const c = e.engine.cars.find((x) => x.driverId === e.heroId)!;
      c.initialS = 0;
      c.s = 3 * len - 3;
      c.v = 80;
      c.lap = 2;
      c.tyre.wear = 0.3;
      c.lapStartTime = c.raceTime;
      c.hammerActiveSecThisLap = 0;
    };
    place(base);
    place(boosted);
    expect(boosted.engine.requestHammer(boosted.heroId)).toBe("activated");
    base.engine.step();
    boosted.engine.step();
    const b = base.engine.cars.find((c) => c.driverId === base.heroId)!;
    const f = boosted.engine.cars.find((c) => c.driverId === boosted.heroId)!;
    const baseWearDelta = b.tyre.wear - 0.3;
    const boostWearDelta = f.tyre.wear - 0.3;
    expect(boostWearDelta).toBeGreaterThan(baseWearDelta);
    expect(boostWearDelta).toBeCloseTo(baseWearDelta * CONFIG.HAMMER_TIME.tyreWearMultiplier, 4);
  });
});
