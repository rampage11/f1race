import type { SkillKey, TyreCompound } from "./types.js";

export const SKILL_KEYS: readonly SkillKey[] = [
  "fitness",
  "reaction",
  "attack",
  "defense",
  "pace",
  "tyreMgmt",
] as const;

export const STARTING_SKILL_POINTS = 10;
export const STARTING_SKILL_MAX = 5;
export const ABSOLUTE_SKILL_MAX = 20;

export const RACE = {
  targetDistanceKm: 85,
  minLaps: 8,
  maxLaps: 30,
} as const;

export const CONFIG = {
  skills: {
    startingPoints: STARTING_SKILL_POINTS,
    startingMaxPerSkill: STARTING_SKILL_MAX,
    absoluteMax: ABSOLUTE_SKILL_MAX,
    pointsPerLevel: 2,
  },

  physics: {
    dtDefault: 0.1,
    maxAccel: 14,
    maxBrake: 26,
    dragCoast: 1.2,
    gridSpacingM: 8,
    pitApproachSpeed: 28,
    brakingOverhead: 1.05,
  },

  pace: {
    skillSecondsPerPoint: 0.08,
    tyreFreshnessPaceWindow: 0.45,
    fatiguePaceSecPerPoint: 0.08,
    fatigueOnsetLapFrac: 0.45,
    noiseSigma: 0.012,
    pushLevel: { conservative: 0.985, balanced: 1.0, attack: 1.012 },
  },

  tyres: {
    soft: {
      paceBonusSec: 0.0,
      gripFresh: 1.0,
      wearPerKm: 0.022,
      degCurve: 1.7,
      cliff: 0.8,
    },
    medium: {
      paceBonusSec: 0.45,
      gripFresh: 1.0,
      wearPerKm: 0.014,
      degCurve: 1.5,
      cliff: 0.84,
    },
    hard: {
      paceBonusSec: 0.9,
      gripFresh: 1.0,
      wearPerKm: 0.01,
      degCurve: 1.3,
      cliff: 0.88,
    },
    intermediate: {
      paceBonusSec: 0.25,
      gripFresh: 1.05,
      wearPerKm: 0.018,
      degCurve: 1.5,
      cliff: 0.85,
    },
    wet: {
      paceBonusSec: 1.1,
      gripFresh: 1.10,
      wearPerKm: 0.012,
      degCurve: 1.4,
      cliff: 0.86,
    },
    tyreMgmtReductionPerPoint: 0.03,
    lapLengthKm: null,
    minGrip: 0.7,
    criticalWearPacePenalty: 2.0,
  },

  pit: {
    pitLaneDeltaSec: 22,
    pitStopDuration: 3.0,
    pitEntryWindowM: 50,
  },

  start: {
    lightsOutT: 0,
    falseStartRt: 0.04,
    perfectWindow: { min: 0.12, max: 0.28 },
    perfectBonusAccel: 4,
    reactionPerfectExpandPerPoint: 0.012,
    reactionFalseStartFloorPerPoint: 0.004,
    latePenaltySecPerSec: 1.6,
  },

  battle: {
    closeGapSec: 1.2,
    attackGapSec: 0.7,
    drsGapSec: 0.5,
    minPaceDeltaForAttackMs: 0.8,
    basePassProb: 0.04,
    paceDeltaWeight: 0.22,
    attackDefenseWeight: 0.06,
    tyreAdvantageWeight: 0.6,
    trainSizeWeight: 0.14,
    overtakeDifficultyWeight: 1.1,
    attackCooldownSec: 15,
    defendPaceLossSec: 0.0,
    attackPaceLossSec: 0.0,
    probFloor: 0.01,
    probCeil: 0.92,
    trainStackingMultiplier: 0.6,
    drsPassMultiplier: 1.20,
  },

  blueFlag: {
    yieldPaceFactor: 0.94,
    triggerGapSec: 2.5,
    minDistM: 8,
    minOvertakingScore: 0.1,
    lappedBasePassProb: 0.88,
    lappedProbFloor: 0.85,
  },

  qualifying: {
    noiseSigma: 0.18,
    fuelBurnCompensation: 0,
  },

  xp: {
    basePerRace: 40,
    perPlaceAheadOfLast: 6,
    fastestLapBonus: 25,
    positionsGainedBonus: 2,
    dnfXp: 10,
    formulaF4: { levelMin: 1, levelMax: 9, gridSize: 20, lapScale: 0.8 },
    formulaF3: { levelMin: 10, levelMax: 19, gridSize: 20, lapScale: 0.9 },
    formulaF2: { levelMin: 20, levelMax: 34, gridSize: 20, lapScale: 1.0 },
    formulaF1: { levelMin: 35, levelMax: 999, gridSize: 20, lapScale: 1.0 },
    polePositionBonus: 20,
  },

  level: {
    xpToNext: (level: number): number => Math.round(100 * Math.pow(level, 1.5)),
  },

  // Two-factor pilot rating: rating = level + (skillSum - startingPoints) * skillWeight.
  // Division + matchmaking use rating (not bare level) so training actually moves status.
  // For a fresh pilot (skillSum === startingPoints) rating === level, so all prior level-based
  // boundaries are preserved exactly. Tunable here — weights are the calibration surface.
  driverRating: {
    skillWeight: 0.5,
    f3RatingMin: 10,
    f2RatingMin: 20,
    f1RatingMin: 35,
  },

  // Background training: duration grows geometrically with the CURRENT skill level, so each
  // next point takes longer than the last (time itself is the diminishing-returns curve).
  // durationSec(level) = baseDurationSec * growthFactor ^ level.
  training: {
    baseDurationSec: 30 * 60,
    growthFactor: 1.6,
    levelDiscountPerLevel: 0.01,
    levelDiscountMax: 0.20,
  },

  HAMMER_TIME: {
    durationSec: 15,
    cooldownSec: 45,
    minTyreWearToActivate: 0.80,
    firstLapLock: true,
    // Three strategic modes. The activating car picks one; the multipliers apply only while
    // its hammer window is open. `defense` > 1 makes that car HARDER to pass when attacked.
    mode: {
      attack: { cornering: 1.05, overtake: 1.40, defense: 1.0,  tyreWear: 1.8 },
      defend: { cornering: 1.10, overtake: 1.0,  defense: 1.50, tyreWear: 1.5 },
      push:   { cornering: 1.20, overtake: 1.10, defense: 1.0,  tyreWear: 2.2 },
    },
  },

  weather: {
    gripMultiplier: { dry: 1.0, lightRain: 0.85, heavyRain: 0.65 },
    overtakeMultiplier: { dry: 1.0, lightRain: 1.15, heavyRain: 1.3 },
    compoundWeatherGrip: {
      soft:     { dry: 1.0, lightRain: 0.75, heavyRain: 0.55 },
      medium:   { dry: 1.0, lightRain: 0.80, heavyRain: 0.60 },
      hard:     { dry: 1.0, lightRain: 0.82, heavyRain: 0.62 },
      intermediate: { dry: 0.80, lightRain: 1.10, heavyRain: 0.95 },
      wet:      { dry: 0.65, lightRain: 1.05, heavyRain: 1.20 },
    },
    compoundWeatherWear: {
      soft:     { dry: 1.0, lightRain: 1.2, heavyRain: 1.5 },
      medium:   { dry: 1.0, lightRain: 1.1, heavyRain: 1.3 },
      hard:     { dry: 1.0, lightRain: 1.05, heavyRain: 1.2 },
      intermediate: { dry: 1.5, lightRain: 0.7, heavyRain: 0.6 },
      wet:      { dry: 2.0, lightRain: 0.6, heavyRain: 0.5 },
    },
    probability: { dry: 0.50, lightRain: 0.25, heavyRain: 0.10, variable: 0.15 },
  },

  timeOfDay: {
    probability: { day: 0.70, sunset: 0.20, night: 0.10 },
  },

  slipstream: {
    gapSec: 2.0,
    paceBonusSec: 0.25,
    minOvertakingScore: 0.3,
  },

  // Random mechanical DNF for drama. basePerLap is the per-lap failure probability; rolled
  // (with a dedicated RNG stream so the physics RNG is untouched) once per lap completion for
  // every car past minLap. Effective per-race chance for a ~12-lap race ≈ 0.5% per car.
  mechanicalFailure: {
    basePerLap: 0.0005,
    minLap: 2,
  },

  // Bot skill budget scales with the room's division so higher divisions field competitive
  // bots (otherwise veterans farm static starter bots). budget = budgetBase + divisionRatingFloor ×
  // budgetCoefficient, then +rand(0..jitterMax). The top `eliteCount` bots get ×eliteMultiplier
  // to create "bosses" slightly above the lobby average.
  bots: {
    budgetBase: 10,
    budgetCoefficient: 0.8,
    jitterMax: 5,
    eliteCount: 3,
    eliteMultiplier: 1.15,
  },
} as const;

export type TyreCompoundConfig = (typeof CONFIG.tyres)[TyreCompound];
