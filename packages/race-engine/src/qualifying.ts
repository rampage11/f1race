import { CONFIG } from "./config.js";
import { baseLapTime } from "./formula.js";
import type { Driver, QualifyingResult } from "./types.js";
import type { Rng } from "./rng.js";

export function qualifyingLapTime(driver: Driver, t0: number, rng: Rng): number {
  const paceBonus = CONFIG.pace.skillSecondsPerPoint * driver.skills.pace;
  const noise = rng.gauss(0, CONFIG.qualifying.noiseSigma);
  const time = t0 - paceBonus + noise;
  const floor = t0 * 0.92;
  return Math.max(floor, time);
}

export function runQualifying(drivers: Driver[], t0: number, rng: Rng): QualifyingResult[] {
  const rows = drivers.map((d) => ({
    driverId: d.id,
    lapTime: qualifyingLapTime(d, t0, rng),
  }));
  rows.sort((a, b) => a.lapTime - b.lapTime);
  return rows.map((r, i) => ({ ...r, gridPosition: i + 1 }));
}

export { baseLapTime };
