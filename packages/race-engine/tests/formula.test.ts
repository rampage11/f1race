import { describe, expect, it } from "vitest";
import {
  CONFIG,
  emptySkills,
  validateStartingAllocation,
  gripFor,
  freshTyre,
  wearDeltaForLap,
  isCliff,
  passProbability,
  paceSpeedMultiplier,
  computeStartOutcome,
  fatigueFactor,
} from "../src/index.js";

describe("skills allocation", () => {
  it("accepts a valid 10-point distribution within the starting cap", () => {
    const s = { ...emptySkills(), pace: 5, attack: 3, defense: 2 };
    const r = validateStartingAllocation(s);
    expect(r.ok).toBe(true);
  });

  it("rejects wrong total", () => {
    const s = { ...emptySkills(), pace: 1 };
    expect(validateStartingAllocation(s).ok).toBe(false);
  });

  it("rejects exceeding the starting cap", () => {
    const s = { ...emptySkills(), pace: 6, defense: 4 };
    expect(validateStartingAllocation(s).ok).toBe(false);
  });
});

describe("tyres", () => {
  it("fresh soft has higher grip than fresh hard", () => {
    expect(gripFor(freshTyre("soft"))).toBeGreaterThan(gripFor(freshTyre("hard")));
  });

  it("wear grows and eventually hits the cliff", () => {
    const t = freshTyre("soft");
    const km = 4.2;
    const perLap = wearDeltaForLap(t, km, 0);
    let w = 0;
    for (let i = 0; i < 50; i++) w += perLap;
    expect(w).toBeGreaterThan(1);
    const worn = { ...t, wear: 0.95 };
    expect(isCliff(worn)).toBe(true);
    expect(gripFor(worn)).toBeLessThan(gripFor(freshTyre("soft")));
  });

  it("tyre management skill reduces wear", () => {
    const t = freshTyre("medium");
    const low = wearDeltaForLap(t, 4.2, 0);
    const high = wearDeltaForLap(t, 4.2, 10);
    expect(high).toBeLessThan(low);
  });
});

describe("pace", () => {
  const base = {
    paceSkill: 0,
    fitnessSkill: 10,
    fatigue01: 0,
    pushLevel: 1,
    tyre: freshTyre("medium"),
    t0: 63,
    noise: 0,
  };
  it("higher pace skill yields higher speed multiplier", () => {
    const low = paceSpeedMultiplier({ ...base, paceSkill: 0 });
    const high = paceSpeedMultiplier({ ...base, paceSkill: 10 });
    expect(high).toBeGreaterThan(low);
  });

  it("fatigue slows a low-fitness driver", () => {
    const fresh = paceSpeedMultiplier({ ...base, fitnessSkill: 10, fatigue01: 1 });
    const tired = paceSpeedMultiplier({ ...base, fitnessSkill: 0, fatigue01: 1 });
    expect(tired).toBeLessThan(fresh);
  });

  it("fatigue factor is zero before onset and grows to 1", () => {
    expect(fatigueFactor(2, 20)).toBe(0);
    expect(fatigueFactor(20, 20)).toBeCloseTo(1, 1);
  });
});

describe("battle (overtaking)", () => {
  const baseInput = {
    attackSkill: 0,
    defenseSkill: 0,
    tyreAdvantage: 0,
    trainSize: 0,
    overtakingScore: 1,
    attackerAlreadyAhead: false,
  };
  it("train holds when pace delta is small", () => {
    const p = passProbability({ ...baseInput, paceDeltaMs: 0.2 });
    expect(p).toBeLessThan(0.08);
  });

  it("pass probability rises with pace delta", () => {
    const slow = passProbability({ ...baseInput, paceDeltaMs: 2 });
    const fast = passProbability({ ...baseInput, paceDeltaMs: 8 });
    expect(fast).toBeGreaterThan(slow);
  });

  it("high defense resists a weak attacker (train holds)", () => {
    const defended = passProbability({
      ...baseInput,
      paceDeltaMs: 0.5,
      attackSkill: 1,
      defenseSkill: 8,
    });
    expect(defended).toBeLessThan(0.05);
  });

  it("a big attacker breaks through a weak defender", () => {
    const through = passProbability({
      ...baseInput,
      paceDeltaMs: 4,
      attackSkill: 8,
      defenseSkill: 1,
      tyreAdvantage: 0.15,
    });
    expect(through).toBeGreaterThan(0.5);
  });

  it("a long train strongly suppresses attacks", () => {
    const solo = passProbability({ ...baseInput, paceDeltaMs: 3, trainSize: 0 });
    const train = passProbability({ ...baseInput, paceDeltaMs: 3, trainSize: 5 });
    expect(train).toBeLessThan(solo);
  });
});

describe("start", () => {
  it("perfect window rewards a well-timed press", () => {
    const out = computeStartOutcome(0.18, 0);
    expect(out.perfect).toBe(true);
    expect(out.bonusAccel).toBeGreaterThan(0);
    expect(out.falseStart).toBe(false);
  });

  it("jump start is flagged", () => {
    const out = computeStartOutcome(0.0, 0);
    expect(out.falseStart).toBe(true);
    expect(out.latePenaltySec).toBeGreaterThan(0);
  });

  it("reaction skill widens the perfect window", () => {
    const early = computeStartOutcome(0.07, 0);
    const earlyWithSkill = computeStartOutcome(0.07, 10);
    expect(earlyWithSkill.perfect).toBe(true);
    expect(early.perfect).toBe(false);
  });

  it("late press adds time penalty", () => {
    const out = computeStartOutcome(0.6, 0);
    expect(out.perfect).toBe(false);
    expect(out.latePenaltySec).toBeGreaterThan(0);
  });
});

describe("config sanity", () => {
  it("tyre compounds are ordered soft > medium > hard by pace bonus", () => {
    const s = CONFIG.tyres.soft.paceBonusSec;
    const m = CONFIG.tyres.medium.paceBonusSec;
    const h = CONFIG.tyres.hard.paceBonusSec;
    expect(s).toBeLessThan(m);
    expect(m).toBeLessThan(h);
  });
});
