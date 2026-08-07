import lapData from "../data/lap.json";
import { pathPointAt } from "@f1race/race-engine";
import type { PathPoint, Point2D } from "@f1race/race-engine";

export interface SpeedSample {
  dM: number;
  kmh: number;
}

export interface LapData {
  trackId: string;
  trackName: string;
  lengthM: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  path: Point2D[];
  cum: number[];
  speed: SpeedSample[];
  speedMin: number;
  speedMax: number;
}

export const LAP: LapData = lapData as LapData;

export function pointAt(frac: number): PathPoint {
  return pathPointAt(LAP.path, LAP.cum, frac);
}

export function speedAtFraction(frac: number): number {
  const f = ((frac % 1) + 1) % 1;
  const speed = LAP.speed;
  const idx = f * speed.length;
  const i0 = Math.floor(idx) % speed.length;
  const i1 = (i0 + 1) % speed.length;
  const t = idx - Math.floor(idx);
  const a = speed[i0];
  const b = speed[i1];
  if (!a || !b) return LAP.speedMin;
  return a.kmh + (b.kmh - a.kmh) * t;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

const C_FAST = "#0EA5E9";
const C_MID = "#F97316";
const C_SLOW = "#C2410C";

export function colorForSpeed(kmh: number): string {
  const { speedMin, speedMax } = LAP;
  const span = speedMax - speedMin || 1;
  const t = Math.max(0, Math.min(1, (kmh - speedMin) / span));
  if (t >= 0.5) return lerpHex(C_FAST, C_MID, (1 - t) / 0.5);
  return lerpHex(C_MID, C_SLOW, (0.5 - t) / 0.5);
}

export function speedTNormal(kmh: number): number {
  const { speedMin, speedMax } = LAP;
  const span = speedMax - speedMin || 1;
  return Math.max(0, Math.min(1, (kmh - speedMin) / span));
}
