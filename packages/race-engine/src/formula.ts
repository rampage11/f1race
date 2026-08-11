import { CONFIG } from "./config.js";
import { compoundPaceBonusSec, gripFor, tyrePacePenaltySec } from "./tyres.js";
import type { HammerMode, PushStrategy, Skills, Track, TyreState, Weather } from "./types.js";

export function baseLapTime(track: Track): number {
  const raw = track.segments.reduce((t, seg) => t + seg.length / seg.targetSpeed, 0);
  return raw * CONFIG.physics.brakingOverhead;
}

function speedMultFromLapBonus(bonusSec: number, t0: number): number {
  return t0 / (t0 + bonusSec);
}

export interface PaceInputs {
  paceSkill: number;
  fitnessSkill: number;
  fatigue01: number;
  pushLevel: number;
  tyre: TyreState;
  t0: number;
  noise: number;
  weather?: Weather;
  towBonusSec?: number;
}

export function paceSpeedMultiplier(input: PaceInputs): number {
  const weather = input.weather ?? "dry";
  const paceBonusSec = -CONFIG.pace.skillSecondsPerPoint * input.paceSkill;
  const fatigueSec = CONFIG.pace.fatiguePaceSecPerPoint * (10 - input.fitnessSkill) * Math.max(0, input.fatigue01);
  const tyrePenalty = tyrePacePenaltySec(input.tyre);
  const compoundPenalty = compoundPaceBonusSec(input.tyre.compound);
  const towBonusSec = input.towBonusSec ?? 0;
  const totalBonus = paceBonusSec + fatigueSec + tyrePenalty + compoundPenalty - towBonusSec;
  const mult = speedMultFromLapBonus(totalBonus, input.t0);
  const grip = gripFor(input.tyre, weather);
  return mult * grip * input.pushLevel * (1 + input.noise);
}

export function targetSpeedForSegment(
  baseTargetSpeed: number,
  input: PaceInputs,
): number {
  return baseTargetSpeed * paceSpeedMultiplier(input);
}

export interface BattleInputs {
  paceDeltaMs: number;
  attackSkill: number;
  defenseSkill: number;
  tyreAdvantage: number;
  trainSize: number;
  overtakingScore: number;
  attackerAlreadyAhead: boolean;
  lapDelta: number;
  weather?: Weather;
  attackerDrsActive?: boolean;
  attackerHammerMode?: HammerMode | null;
  defenderHammerMode?: HammerMode | null;
}

function effectiveWeatherOf(w: Weather | undefined): "dry" | "lightRain" | "heavyRain" {
  const v = w ?? "dry";
  return v === "variable" ? "dry" : v;
}

export function passProbability(input: BattleInputs): number {
  const b = CONFIG.battle;
  const paceTerm = input.paceDeltaMs * b.paceDeltaWeight;
  const tyreTerm = input.tyreAdvantage * b.tyreAdvantageWeight;
  const w = effectiveWeatherOf(input.weather);
  const weatherMult = CONFIG.weather.overtakeMultiplier[w];
  const hammerAtk = input.attackerHammerMode ? CONFIG.HAMMER_TIME.mode[input.attackerHammerMode].overtake : 1;
  const drsMult = input.attackerDrsActive ? CONFIG.battle.drsPassMultiplier : 1;
  const comboMult = weatherMult * hammerAtk * drsMult;

  if (input.lapDelta >= 1) {
    const bf = CONFIG.blueFlag;
    let p = bf.lappedBasePassProb + paceTerm + tyreTerm;
    p *= Math.pow(input.overtakingScore, b.overtakeDifficultyWeight);
    p *= comboMult;
    return Math.max(bf.lappedProbFloor, Math.min(b.probCeil, p));
  }
  const effDefense = input.defenderHammerMode
    ? input.defenseSkill * CONFIG.HAMMER_TIME.mode[input.defenderHammerMode].defense
    : input.defenseSkill;
  const adTerm = (input.attackSkill - effDefense) * b.attackDefenseWeight;
  const trainTerm = input.trainSize * b.trainSizeWeight;
  let p =
    b.basePassProb +
    paceTerm +
    adTerm +
    tyreTerm -
    trainTerm;
  p *= Math.pow(input.overtakingScore, b.overtakeDifficultyWeight);
  p *= comboMult;
  p = Math.max(b.probFloor, Math.min(b.probCeil, p));
  if (input.paceDeltaMs < b.minPaceDeltaForAttackMs) {
    p *= 0.1;
  }
  return p;
}

export interface StartOutcome {
  falseStart: boolean;
  perfect: boolean;
  effectiveGoDelay: number;
  bonusAccel: number;
  latePenaltySec: number;
}

export function computeStartOutcome(reactionTimeSec: number, reactionSkill: number): StartOutcome {
  const s = CONFIG.start;
  const rxn = Math.max(0, reactionSkill);
  const expand = s.reactionPerfectExpandPerPoint * rxn;
  const perfectMin = Math.max(0.02, s.perfectWindow.min - expand);
  const perfectMax = s.perfectWindow.max + expand;
  const falseFloor = Math.max(0.01, s.falseStartRt - s.reactionFalseStartFloorPerPoint * rxn);

  if (reactionTimeSec < falseFloor) {
    return {
      falseStart: true,
      perfect: false,
      effectiveGoDelay: 0,
      bonusAccel: 0,
      latePenaltySec: 5,
    };
  }

  const perfect = reactionTimeSec >= perfectMin && reactionTimeSec <= perfectMax;
  const clampedAbove = Math.max(0, reactionTimeSec - perfectMin);
  const bonusAccel = perfect ? s.perfectBonusAccel : 0;
  const lateOver = Math.max(0, reactionTimeSec - perfectMax);
  const latePenaltySec = lateOver * s.latePenaltySecPerSec;
  return {
    falseStart: false,
    perfect,
    effectiveGoDelay: clampedAbove,
    bonusAccel,
    latePenaltySec,
  };
}

export type StartCategory = "perfect" | "good" | "slow" | "verySlow" | "jumpStart";

export function startCategory(reactionSec: number, jumpStart: boolean): StartCategory {
  if (jumpStart) return "jumpStart";
  if (reactionSec < 0.15) return "perfect";
  if (reactionSec < 0.35) return "good";
  if (reactionSec < 0.60) return "slow";
  return "verySlow";
}

export function fatigueFactor(currentLap: number, totalLaps: number): number {
  const onset = CONFIG.pace.fatigueOnsetLapFrac;
  if (totalLaps <= 0) return 0;
  const frac = currentLap / totalLaps;
  if (frac <= onset) return 0;
  return Math.min(1, (frac - onset) / (1 - onset));
}

export function pushLevelFor(strategy: PushStrategy): number {
  return CONFIG.pace.pushLevel[strategy];
}

export function pushWearFor(strategy: PushStrategy): number {
  return CONFIG.pace.pushWear[strategy];
}

export function xpForRace(args: {
  place: number;
  gridSize: number;
  fastestLap: boolean;
  positionsGained: number;
  dnf: boolean;
  polePosition?: boolean;
}): number {
  const x = CONFIG.xp;
  if (args.dnf) return x.dnfXp;
  const placesAheadOfLast = Math.max(0, args.gridSize - args.place);
  let xp = x.basePerRace + placesAheadOfLast * x.perPlaceAheadOfLast;
  if (args.fastestLap) xp += x.fastestLapBonus;
  if (args.polePosition) xp += x.polePositionBonus;
  xp += args.positionsGained * x.positionsGainedBonus;
  return xp;
}

export function skillSum(s: Skills): number {
  return s.fitness + s.reaction + s.attack + s.defense + s.pace + s.tyreMgmt;
}

// Guard against pathological inputs / runaway loops on absurd XP values.
const MAX_LEVEL = 999;

export function levelFromXp(totalXp: number): number {
  let level = 1;
  let remaining = totalXp;
  while (level < MAX_LEVEL) {
    const need = CONFIG.level.xpToNext(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return level;
}

export function divisionForLevel(level: number): "F4" | "F3" | "F2" | "F1" {
  const x = CONFIG.xp;
  if (level >= x.formulaF1.levelMin) return "F1";
  if (level >= x.formulaF2.levelMin) return "F2";
  if (level >= x.formulaF3.levelMin) return "F3";
  return "F4";
}

export function driverRating(level: number, skillSumValue: number): number {
  const r = CONFIG.driverRating;
  const skillBonus = (skillSumValue - CONFIG.skills.startingPoints) * r.skillWeight;
  return Math.floor(level + skillBonus);
}

export function divisionForRating(rating: number): "F4" | "F3" | "F2" | "F1" {
  const r = CONFIG.driverRating;
  if (rating >= r.f1RatingMin) return "F1";
  if (rating >= r.f2RatingMin) return "F2";
  if (rating >= r.f3RatingMin) return "F3";
  return "F4";
}

export function divisionIndex(division: "F4" | "F3" | "F2" | "F1"): number {
  if (division === "F1") return 3;
  if (division === "F2") return 2;
  if (division === "F3") return 1;
  return 0;
}

// Skill points accrued when totalXp moves from oldTotalXp to newTotalXp: pointsPerLevel per
// level gained (0 if no level-up, never negative). Called from the race-finish / tutorial-finish
// paths so leveling up actually rewards spendable skill points (pointsPerLevel was previously
// defined but unused — the core progression gap).
export function levelUpPointsAccrued(oldTotalXp: number, newTotalXp: number): number {
  const oldLevel = levelFromXp(oldTotalXp);
  const newLevel = levelFromXp(newTotalXp);
  const gained = Math.max(0, newLevel - oldLevel);
  return gained * CONFIG.skills.pointsPerLevel;
}

export function trainingDurationSec(currentSkillLevel: number, driverLevel = 1): number {
  const t = CONFIG.training;
  const discount = Math.min(t.levelDiscountMax, Math.max(0, driverLevel - 1) * t.levelDiscountPerLevel);
  const factor = 1 - discount;
  if (currentSkillLevel < t.fastLevels) {
    return Math.round(t.fastBaseDurationSec * factor);
  }
  return Math.round(t.baseDurationSec * Math.pow(t.growthFactor, currentSkillLevel) * factor);
}
