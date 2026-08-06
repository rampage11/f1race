import { describe, expect, it } from "vitest";
import {
  RaceEngine,
  buildRaceConfig,
  emptySkills,
  makeBot,
  makeDriver,
  mulberry32,
  recommendedLaps,
  redBullRing,
  type Driver,
  type RaceResult,
  type RaceSnapshot,
} from "../src/index.js";

const SEED = 1337;
const STEP_REQUEST_HERO = 60;
const STEP_REQUEST_RIVAL = 220;
const STEP_CANCEL_HERO = 400;
const STEP_GUARD = 500_000;

function buildField(): { drivers: Driver[]; heroId: string; rivalId: string } {
  const rng = mulberry32(20240101);
  const hero = makeDriver({
    name: "Hero",
    country: "RU",
    kind: "human",
    skills: { ...emptySkills(), pace: 6, attack: 4, defense: 4, fitness: 3 },
    startingTyre: "medium",
    pitPlan: { targetStops: 1, strategy: "flexible", compound: "soft" },
  });
  const bots: Driver[] = [];
  for (let i = 0; i < 5; i++) bots.push(makeBot({}, rng));
  const drivers = [hero, ...bots];
  const rival = bots[0];
  if (!rival) throw new Error("field must include a rival bot");
  return { drivers, heroId: hero.id, rivalId: rival.id };
}

function stepRace(
  seed: number,
  drivers: Driver[],
  heroId: string,
  rivalId: string,
): RaceResult {
  const track = redBullRing();
  const cfg = buildRaceConfig({
    track,
    drivers,
    totalLaps: recommendedLaps(track),
    seed,
    dt: 0.1,
    heroId,
  });
  const engine = new RaceEngine(cfg);
  for (let i = 0; engine.phase === "racing"; i++) {
    engine.step();
    if (i === STEP_REQUEST_HERO) engine.requestPit(heroId, "soft");
    if (i === STEP_REQUEST_RIVAL) engine.requestPit(rivalId, "hard");
    if (i === STEP_CANCEL_HERO) engine.cancelPit(heroId);
    if (i > STEP_GUARD) throw new Error("race did not finish within step guard");
  }
  return engine.result();
}

describe("RaceEngine determinism (spec P18)", () => {
  it("same seed and same step-indexed inputs produce an identical result", () => {
    const { drivers, heroId, rivalId } = buildField();
    const first = stepRace(SEED, drivers, heroId, rivalId);
    const second = stepRace(SEED, drivers, heroId, rivalId);

    expect(second).toEqual(first);
    expect(second.fastestLapDriverId).toBe(first.fastestLapDriverId);
    expect(second.rows.map((r) => r.driverId)).toEqual(first.rows.map((r) => r.driverId));
    expect(second.rows.map((r) => r.raceTime)).toEqual(first.rows.map((r) => r.raceTime));
    expect(second.rows.map((r) => r.bestLapTime)).toEqual(first.rows.map((r) => r.bestLapTime));
    expect(second.rows.map((r) => r.place)).toEqual(first.rows.map((r) => r.place));
    expect(second.events).toEqual(first.events);
  });

  it("different seed produces a different result (sanity)", () => {
    const { drivers, heroId, rivalId } = buildField();
    const base = stepRace(SEED, drivers, heroId, rivalId);
    const other = stepRace(SEED + 1, drivers, heroId, rivalId);

    expect(other).not.toEqual(base);
    expect(other.rows.map((r) => r.raceTime)).not.toEqual(
      base.rows.map((r) => r.raceTime),
    );
  });

  it("mid-race snapshot is identical at a fixed stepIndex (replay primitive)", () => {
    const { drivers, heroId, rivalId } = buildField();
    const track = redBullRing();
    const MID_STEP = 300;

    const snapshotAt = (seed: number): RaceSnapshot => {
      const cfg = buildRaceConfig({
        track,
        drivers,
        totalLaps: recommendedLaps(track),
        seed,
        dt: 0.1,
        heroId,
      });
      const engine = new RaceEngine(cfg);
      for (let i = 0; i < MID_STEP && engine.phase === "racing"; i++) {
        engine.step();
        if (i === STEP_REQUEST_HERO) engine.requestPit(heroId, "soft");
        if (i === STEP_REQUEST_RIVAL) engine.requestPit(rivalId, "hard");
      }
      return engine.snapshot();
    };

    const a = snapshotAt(SEED);
    const b = snapshotAt(SEED);
    expect(b).toEqual(a);
  });
});
