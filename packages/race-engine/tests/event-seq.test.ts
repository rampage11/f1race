import { describe, expect, it } from "vitest";
import {
  RaceEngine,
  buildRaceConfig,
  emptySkills,
  makeBot,
  makeDriver,
  mulberry32,
  redBullRing,
  type Driver,
} from "../src/index.js";

function heroAndBots(): { drivers: Driver[]; heroId: string } {
  const hero = makeDriver({
    name: "Hero",
    country: "RU",
    kind: "human",
    skills: { ...emptySkills(), pace: 6 },
    startingTyre: "medium",
    pitPlan: { targetStops: 1, compound: "soft" },
  });
  const bots = [makeBot({}, mulberry32(1)), makeBot({}, mulberry32(2))];
  return { drivers: [hero, ...bots], heroId: hero.id };
}

describe("S1-5: race events carry a monotonic seq", () => {
  it("assigns increasing seq to every emitted event (1..N)", () => {
    const { drivers } = heroAndBots();
    const cfg = buildRaceConfig({ track: redBullRing(), drivers, totalLaps: 6, seed: 11, dt: 0.1 });
    const engine = new RaceEngine(cfg);
    const result = engine.run();

    expect(result.events.length).toBeGreaterThan(0);
    for (let i = 0; i < result.events.length; i++) {
      expect(typeof result.events[i]!.seq).toBe("number");
      expect(result.events[i]!.seq).toBe(i + 1);
    }
  });

  it("snapshot().eventSeq equals the last emitted event's seq", () => {
    const { drivers } = heroAndBots();
    const cfg = buildRaceConfig({ track: redBullRing(), drivers, totalLaps: 6, seed: 13, dt: 0.1 });
    const engine = new RaceEngine(cfg);
    for (let i = 0; i < 5000 && engine.phase === "racing"; i++) engine.step();
    const snap = engine.snapshot();
    const last = snap.events[snap.events.length - 1]!;
    expect(snap.eventSeq).toBe(last.seq);
    expect(engine.currentEventSeq).toBe(snap.eventSeq);
  });

  it("snapshot().events is a defensive copy (mutating it doesn't touch the engine)", () => {
    const { drivers } = heroAndBots();
    const cfg = buildRaceConfig({ track: redBullRing(), drivers, totalLaps: 6, seed: 17, dt: 0.1 });
    const engine = new RaceEngine(cfg);
    for (let i = 0; i < 5000 && engine.phase === "racing"; i++) engine.step();
    const snap = engine.snapshot();
    const beforeLen = snap.events.length;
    const beforeSeq = snap.eventSeq;

    snap.events.push({ seq: 99999, t: -1, type: "info", message: "tamper" });
    snap.events.length = 0;

    const snap2 = engine.snapshot();
    expect(snap2.events.length).toBe(beforeLen);
    expect(snap2.eventSeq).toBe(beforeSeq);
    expect(snap2.events.some((e) => e.seq === 99999)).toBe(false);
  });

  it("race_start is the first event (seq 1) at construction time", () => {
    const { drivers } = heroAndBots();
    const cfg = buildRaceConfig({ track: redBullRing(), drivers, totalLaps: 4, seed: 3, dt: 0.1 });
    const engine = new RaceEngine(cfg);
    const snap = engine.snapshot();
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]!.seq).toBe(1);
    expect(snap.events[0]!.type).toBe("race_start");
    expect(snap.eventSeq).toBe(1);
  });
});
