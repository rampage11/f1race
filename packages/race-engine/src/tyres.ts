import { CONFIG } from "./config.js";
import type { TyreCompound, TyreState } from "./types.js";

export function freshTyre(compound: TyreCompound): TyreState {
  return { compound, wear: 0, ageLaps: 0 };
}

export function gripFor(t: TyreState): number {
  const cfg = CONFIG.tyres[t.compound];
  const w = Math.min(1, t.wear);
  const isCliff = w >= cfg.cliff;
  const deg = Math.pow(w / cfg.cliff, cfg.degCurve);
  const base = isCliff ? cfg.gripFresh * (1 - 0.35 * Math.pow((w - cfg.cliff) / (1 - cfg.cliff), 2)) : cfg.gripFresh * (1 - 0.12 * deg);
  return Math.max(CONFIG.tyres.minGrip, base);
}

export function wearDeltaForLap(t: TyreState, lapLengthKm: number, tyreMgmt: number): number {
  const cfg = CONFIG.tyres[t.compound];
  const reduction = 1 - CONFIG.tyres.tyreMgmtReductionPerPoint * Math.max(0, tyreMgmt);
  const clampedReduction = Math.max(0.55, reduction);
  return cfg.wearPerKm * lapLengthKm * clampedReduction;
}

export function isCliff(t: TyreState): boolean {
  return t.wear >= CONFIG.tyres[t.compound].cliff;
}

export function tyrePacePenaltySec(t: TyreState): number {
  if (!isCliff(t)) return 0;
  const cfg = CONFIG.tyres[t.compound];
  const over = (t.wear - cfg.cliff) / (1 - cfg.cliff);
  return CONFIG.tyres.criticalWearPacePenalty * over * over;
}

export function compoundPaceBonusSec(compound: TyreCompound): number {
  return CONFIG.tyres[compound].paceBonusSec;
}
