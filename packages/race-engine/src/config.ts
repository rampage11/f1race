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
    fastestLapBonus: 15,
    positionsGainedBonus: 4,
    dnfXp: 10,
    formulaF4: { levelMin: 1, levelMax: 9, gridSize: 20, lapScale: 0.8 },
    formulaF3: { levelMin: 10, levelMax: 19, gridSize: 20, lapScale: 0.9 },
    formulaF2: { levelMin: 20, levelMax: 34, gridSize: 20, lapScale: 1.0 },
    formulaF1: { levelMin: 35, levelMax: 999, gridSize: 20, lapScale: 1.0 },
  },

  level: {
    xpToNext: (level: number): number => Math.round(100 * Math.pow(level, 1.5)),
  },
} as const;

export type TyreCompoundConfig = (typeof CONFIG.tyres)[TyreCompound];
