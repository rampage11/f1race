import { describe, expect, it } from "vitest";
import {
  CONFIG,
  emptySkills,
  validateStartingAllocation,
  gripFor,
  freshTyre,
  wearDeltaForLap,
  isCliff,
  compoundPaceBonusSec,
  passProbability,
  paceSpeedMultiplier,
  computeStartOutcome,
  fatigueFactor,
  levelFromXp,
  levelUpPointsAccrued,
  divisionForLevel,
  driverRating,
  divisionForRating,
  trainingDurationSec,
  skillSum,
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
  it("fresh compounds have equal grip; soft has smaller pace penalty than hard", () => {
    expect(gripFor(freshTyre("soft"))).toBeCloseTo(gripFor(freshTyre("hard")), 5);
    expect(compoundPaceBonusSec("soft")).toBeLessThan(compoundPaceBonusSec("medium"));
    expect(compoundPaceBonusSec("medium")).toBeLessThan(compoundPaceBonusSec("hard"));
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
  it("pace speed multiplier: soft faster baseline, hard penalised", () => {
    const soft = paceSpeedMultiplier({ ...base, tyre: freshTyre("soft") });
    const medium = paceSpeedMultiplier({ ...base, tyre: freshTyre("medium") });
    const hard = paceSpeedMultiplier({ ...base, tyre: freshTyre("hard") });
    expect(soft).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(hard);
  });

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
    lapDelta: 0,
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

describe("xp / level progression", () => {
  it("0 XP is level 1", () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it("exactly xpToNext(1) promotes to level 2", () => {
    const need = CONFIG.level.xpToNext(1);
    expect(levelFromXp(need)).toBe(2);
  });

  it("one less than xpToNext(1) stays at level 1", () => {
    const need = CONFIG.level.xpToNext(1);
    expect(levelFromXp(need - 1)).toBe(1);
  });

  it("is monotonic non-decreasing in totalXp", () => {
    let prev = levelFromXp(0);
    for (let xp = 50; xp <= 5000; xp += 50) {
      const lvl = levelFromXp(xp);
      expect(lvl).toBeGreaterThanOrEqual(prev);
      prev = lvl;
    }
    expect(prev).toBeGreaterThan(1);
  });

  it("caps at MAX_LEVEL for absurd XP", () => {
    expect(levelFromXp(1e15)).toBe(999);
    expect(levelFromXp(Number.MAX_VALUE)).toBe(999);
  });

  it("divisionForLevel maps the F4/F3/F2/F1 boundaries", () => {
    expect(divisionForLevel(1)).toBe("F4");
    expect(divisionForLevel(9)).toBe("F4");
    expect(divisionForLevel(10)).toBe("F3");
    expect(divisionForLevel(19)).toBe("F3");
    expect(divisionForLevel(20)).toBe("F2");
    expect(divisionForLevel(34)).toBe("F2");
    expect(divisionForLevel(35)).toBe("F1");
    expect(divisionForLevel(999)).toBe("F1");
  });
});

describe("driver rating (two-factor progression)", () => {
  it("equals level when skillSum === startingPoints (fresh pilot invariant)", () => {
    expect(driverRating(1, 10)).toBe(1);
    expect(driverRating(9, 10)).toBe(9);
    expect(driverRating(34, 10)).toBe(34);
  });

  it("grows with skillSum beyond the starting points", () => {
    // weight 0.5: 20 extra points → +10 rating
    expect(driverRating(1, 30)).toBe(11);
    expect(driverRating(10, 30)).toBe(20);
  });

  it("is floored to an integer", () => {
    expect(driverRating(1, 11)).toBe(1);
    expect(driverRating(1, 13)).toBe(2);
  });

  it("divisionForRating preserves fresh-pilot F-boundaries (rating === level)", () => {
    expect(divisionForRating(1)).toBe("F4");
    expect(divisionForRating(9)).toBe("F4");
    expect(divisionForRating(10)).toBe("F3");
    expect(divisionForRating(19)).toBe("F3");
    expect(divisionForRating(20)).toBe("F2");
    expect(divisionForRating(34)).toBe("F2");
    expect(divisionForRating(35)).toBe("F1");
  });

  it("training raises rating enough to promote division without racing", () => {
    // Level 1, but heavily trained: skillSum 30 → rating 11 → F3 (not F4).
    expect(divisionForRating(driverRating(1, 30))).toBe("F3");
  });

  it("a fresh pilot's rating-derived division equals their level-derived division", () => {
    for (const level of [1, 5, 9, 10, 15, 20, 34, 35, 50]) {
      expect(divisionForRating(driverRating(level, 10))).toBe(divisionForLevel(level));
    }
  });
});

describe("levelUpPointsAccrued", () => {
  it("returns 0 when no level is gained", () => {
    expect(levelUpPointsAccrued(0, 50)).toBe(0);
    expect(levelUpPointsAccrued(500, 500)).toBe(0);
  });

  it("returns pointsPerLevel per level gained (and never negative)", () => {
    const ppl = CONFIG.skills.pointsPerLevel;
    const low = 0; // level 1
    const hi = 500; // level 3 under the 1.3 curve (100 + 246 = 346 for L3)
    const gained = levelFromXp(hi) - levelFromXp(low);
    expect(gained).toBeGreaterThan(0);
    expect(levelUpPointsAccrued(low, hi)).toBe(gained * ppl);
  });

  it("never accrues for an XP loss", () => {
    expect(levelUpPointsAccrued(500, 100)).toBe(0);
  });
});

describe("training duration", () => {
  it("fast tier: the first `fastLevels` levels are a flat fast-base (new-player hook)", () => {
    const fast = CONFIG.training.fastBaseDurationSec;
    for (let lvl = 0; lvl < CONFIG.training.fastLevels; lvl++) {
      expect(trainingDurationSec(lvl)).toBe(fast);
    }
  });

  it("normal tier: grows geometrically with current skill level from fastLevels onward", () => {
    const base = CONFIG.training.baseDurationSec;
    const g = CONFIG.training.growthFactor;
    const start = CONFIG.training.fastLevels;
    expect(trainingDurationSec(start)).toBe(Math.round(base * Math.pow(g, start)));
    expect(trainingDurationSec(start + 2)).toBe(Math.round(base * Math.pow(g, start + 2)));
  });

  it("the fast tier is much cheaper than the first normal-tier level (hook then grind)", () => {
    expect(trainingDurationSec(CONFIG.training.fastLevels)).toBeGreaterThan(
      trainingDurationSec(CONFIG.training.fastLevels - 1),
    );
  });

  it("is non-decreasing, and strictly increasing from the normal tier onward", () => {
    let prev = 0;
    for (let lvl = 0; lvl <= 15; lvl++) {
      const d = trainingDurationSec(lvl);
      expect(d).toBeGreaterThanOrEqual(prev);
      if (lvl >= CONFIG.training.fastLevels) {
        expect(d).toBeGreaterThan(prev);
      }
      prev = d;
    }
  });

  it("skillSum sums all six skills", () => {
    expect(skillSum(emptySkills())).toBe(0);
    expect(skillSum({ ...emptySkills(), pace: 3, attack: 2, defense: 2, fitness: 1, reaction: 1, tyreMgmt: 1 })).toBe(10);
  });
});
