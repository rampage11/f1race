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
    fatiguePaceSecPerPoint: 0.06,
    fatigueOnsetLapFrac: 0.6,
    noiseSigma: 0.025,
    pushLevel: { conservative: 0.985, balanced: 1.0, attack: 1.012 },
  },

  tyres: {
    soft: {
      paceBonusSec: 0.0,
      gripFresh: 1.04,
      wearPerKm: 0.012,
      degCurve: 1.9,
      cliff: 0.82,
    },
    medium: {
      paceBonusSec: 0.35,
      gripFresh: 1.0,
      wearPerKm: 0.0075,
      degCurve: 1.55,
      cliff: 0.86,
    },
    hard: {
      paceBonusSec: 0.7,
      gripFresh: 0.965,
      wearPerKm: 0.005,
      degCurve: 1.3,
      cliff: 0.9,
    },
    tyreMgmtReductionPerPoint: 0.03,
    lapLengthKm: null,
    minGrip: 0.7,
    criticalWearPacePenalty: 4.5,
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
    minPaceDeltaForAttackMs: 1.5,
    basePassProb: 0.04,
    paceDeltaWeight: 0.14,
    attackDefenseWeight: 0.04,
    tyreAdvantageWeight: 0.6,
    trainSizeWeight: 0.14,
    overtakeDifficultyWeight: 1.1,
    attackCooldownSec: 15,
    defendPaceLossSec: 0.18,
    attackPaceLossSec: 0.12,
    probFloor: 0.01,
    probCeil: 0.92,
    trainStackingMultiplier: 0.6,
  },

  qualifying: {
    noiseSigma: 0.06,
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
