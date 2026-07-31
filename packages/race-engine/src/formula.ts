import { CONFIG } from "./config.js";
import { gripFor, tyrePacePenaltySec } from "./tyres.js";
import type { Skills, Track, TyreState } from "./types.js";

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
}

export function paceSpeedMultiplier(input: PaceInputs): number {
  const paceBonusSec = -CONFIG.pace.skillSecondsPerPoint * input.paceSkill;
  const fatigueSec = CONFIG.pace.fatiguePaceSecPerPoint * (10 - input.fitnessSkill) * Math.max(0, input.fatigue01);
  const tyrePenalty = tyrePacePenaltySec(input.tyre);
  const totalBonus = paceBonusSec + fatigueSec + tyrePenalty;
  const mult = speedMultFromLapBonus(totalBonus, input.t0);
  const grip = gripFor(input.tyre);
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
}

export function passProbability(input: BattleInputs): number {
  const b = CONFIG.battle;
  const paceTerm = input.paceDeltaMs * b.paceDeltaWeight;
  const adTerm = (input.attackSkill - input.defenseSkill) * b.attackDefenseWeight;
  const tyreTerm = input.tyreAdvantage * b.tyreAdvantageWeight;
  const trainTerm = input.trainSize * b.trainSizeWeight;
  let p =
    b.basePassProb +
    paceTerm +
    adTerm +
    tyreTerm -
    trainTerm;
  p *= Math.pow(input.overtakingScore, b.overtakeDifficultyWeight);
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

export function fatigueFactor(currentLap: number, totalLaps: number): number {
  const onset = CONFIG.pace.fatigueOnsetLapFrac;
  if (totalLaps <= 0) return 0;
  const frac = currentLap / totalLaps;
  if (frac <= onset) return 0;
  return Math.min(1, (frac - onset) / (1 - onset));
}

export function pushLevelFor(strategy: "conservative" | "balanced" | "attack"): number {
  return CONFIG.pace.pushLevel[strategy];
}

export function xpForRace(args: {
  place: number;
  gridSize: number;
  fastestLap: boolean;
  positionsGained: number;
  dnf: boolean;
}): number {
  const x = CONFIG.xp;
  if (args.dnf) return x.dnfXp;
  const placesAheadOfLast = Math.max(0, args.gridSize - args.place);
  let xp = x.basePerRace + placesAheadOfLast * x.perPlaceAheadOfLast;
  if (args.fastestLap) xp += x.fastestLapBonus;
  xp += args.positionsGained * x.positionsGainedBonus;
  return xp;
}

export function skillSum(s: Skills): number {
  return s.fitness + s.reaction + s.attack + s.defense + s.pace + s.tyreMgmt;
}
