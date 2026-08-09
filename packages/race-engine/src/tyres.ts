import { CONFIG } from "./config.js";
import type { TyreCompound, TyreState, Weather } from "./types.js";

type EffectiveWeather = "dry" | "lightRain" | "heavyRain";

function effectiveWeather(w: Weather): EffectiveWeather {
  return w === "variable" ? "dry" : w;
}

export function freshTyre(compound: TyreCompound): TyreState {
  return { compound, wear: 0, ageLaps: 0 };
}

export function gripFor(t: TyreState, weather: Weather = "dry"): number {
  const cfg = CONFIG.tyres[t.compound];
  const w = effectiveWeather(weather);
  const weatherGrip = CONFIG.weather.gripMultiplier[w];
  const compoundGrip = CONFIG.weather.compoundWeatherGrip[t.compound][w];
  const raw = Math.min(1, t.wear);
  const isCliff = raw >= cfg.cliff;
  const deg = Math.pow(raw / cfg.cliff, cfg.degCurve);
  const base = isCliff ? cfg.gripFresh * (1 - 0.35 * Math.pow((raw - cfg.cliff) / (1 - cfg.cliff), 2)) : cfg.gripFresh * (1 - 0.03 * deg);
  const gripFromWear = Math.max(CONFIG.tyres.minGrip, base);
  return gripFromWear * weatherGrip * compoundGrip;
}

export function wearDeltaForLap(t: TyreState, lapLengthKm: number, tyreMgmt: number, weather: Weather = "dry"): number {
  const cfg = CONFIG.tyres[t.compound];
  const w = effectiveWeather(weather);
  const weatherWear = CONFIG.weather.compoundWeatherWear[t.compound][w];
  const reduction = 1 - CONFIG.tyres.tyreMgmtReductionPerPoint * Math.max(0, tyreMgmt);
  const clampedReduction = Math.max(0.55, reduction);
  return cfg.wearPerKm * lapLengthKm * clampedReduction * weatherWear;
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

export function estimateTyreLifespanLaps(
  compound: TyreCompound,
  tyreMgmt: number,
  lapLengthKm: number,
): number {
  const cfg = CONFIG.tyres[compound];
  const reduction = 1 - CONFIG.tyres.tyreMgmtReductionPerPoint * Math.max(0, tyreMgmt);
  const clampedReduction = Math.max(0.55, reduction);
  const wearPerLap = cfg.wearPerKm * lapLengthKm * clampedReduction;
  if (wearPerLap <= 0) return 999;
  return Math.max(1, Math.floor(cfg.cliff / wearPerLap));
}
