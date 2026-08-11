import { CONFIG, RACE } from "./config.js";
import { INTERLAGOS_DATA, MONZA_DATA, RED_BULL_DATA } from "./track-data.js";
import type { PathPoint, Point2D, Track, TrackSegment } from "./types.js";

export function trackLengthM(track: Track): number {
  return track.segments.reduce((s, seg) => s + seg.length, 0);
}

export function trackLengthKm(track: Track): number {
  return trackLengthM(track) / 1000;
}

export function recommendedLaps(
  track: Track,
  targetKm: number = RACE.targetDistanceKm,
  minLaps: number = RACE.minLaps,
  maxLaps: number = RACE.maxLaps,
): number {
  const lapKm = trackLengthKm(track);
  const laps = Math.ceil(targetKm / lapKm);
  return Math.max(minLaps, Math.min(maxLaps, laps));
}

void CONFIG;

const segmentBoundariesCache = new WeakMap<Track, number[]>();

export function segmentBoundaries(track: Track): number[] {
  const cached = segmentBoundariesCache.get(track);
  if (cached) return cached;
  const cum: number[] = [0];
  let acc = 0;
  for (const seg of track.segments) {
    acc += seg.length;
    cum.push(acc);
  }
  segmentBoundariesCache.set(track, cum);
  return cum;
}

export function segmentIndexAtS(track: Track, s: number): { index: number; offset: number } {
  const cum = segmentBoundaries(track);
  const total = cum[cum.length - 1]!;
  const norm = ((s % total) + total) % total;
  const n = track.segments.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= norm) lo = mid;
    else hi = mid - 1;
  }
  const idx = Math.min(lo, n - 1);
  return { index: idx, offset: norm - cum[idx]! };
}

export function segmentAtS(track: Track, s: number): TrackSegment {
  return track.segments[segmentIndexAtS(track, s).index]!;
}

export function overtakingScoreAround(track: Track, s: number): number {
  const { index } = segmentIndexAtS(track, s);
  const segs = track.segments;
  const a = segs[index]!.overtaking;
  const prev = segs[(index - 1 + segs.length) % segs.length]!.overtaking;
  const next = segs[(index + 1) % segs.length]!.overtaking;
  return 0.5 * a + 0.25 * prev + 0.25 * next;
}

export function pathCumulative(path: Point2D[]): number[] {
  const cum: number[] = [0];
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const b = path[(i + 1) % path.length]!;
    cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
}

export function pathPointAt(path: Point2D[], cum: number[], fraction: number): PathPoint {
  const total = cum[cum.length - 1]!;
  const f = ((fraction % 1) + 1) % 1;
  const target = f * total;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1]! < target) i++;
  const a = path[i]!;
  const b = path[(i + 1) % path.length]!;
  const segLen = Math.max(1e-6, cum[i + 1]! - cum[i]!);
  const t = (target - cum[i]!) / segLen;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

export function pathBounds(path: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of path) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function redBullRing(): Track {
  const length = RED_BULL_DATA.lengthM;
  return {
    id: "red_bull_ring",
    name: "Red Bull Ring",
    country: "AT",
    lengthM: length,
    segments: RED_BULL_DATA.segments,
    path2D: RED_BULL_DATA.path2D,
    pitLaneDelta: 25,
    pitStopDuration: 3.0,
    pitEntryS: Math.round(length * 0.97),
    pitExitS: Math.round(length * 0.03),
    laps: 12,
    drsZones: RED_BULL_DATA.drsZones,
    sectors: RED_BULL_DATA.sectors,
  };
}

export function monza(): Track {
  const length = MONZA_DATA.lengthM;
  return {
    id: "monza",
    name: "Monza",
    country: "IT",
    lengthM: length,
    segments: MONZA_DATA.segments,
    path2D: MONZA_DATA.path2D,
    pitLaneDelta: 24,
    pitStopDuration: 3.0,
    pitEntryS: Math.round(length * 0.97),
    pitExitS: Math.round(length * 0.03),
    laps: 9,
    drsZones: MONZA_DATA.drsZones,
    sectors: MONZA_DATA.sectors,
  };
}

export function interlagos(): Track {
  const length = INTERLAGOS_DATA.lengthM;
  return {
    id: "interlagos",
    name: "Autódromo José Carlos Pace",
    country: "BR",
    lengthM: length,
    segments: INTERLAGOS_DATA.segments,
    path2D: INTERLAGOS_DATA.path2D,
    pitLaneDelta: 23,
    pitStopDuration: 3.0,
    pitEntryS: Math.round(length * 0.97),
    pitExitS: Math.round(length * 0.03),
    laps: 12,
    drsZones: INTERLAGOS_DATA.drsZones,
    sectors: INTERLAGOS_DATA.sectors,
  };
}

export const TRACKS: Track[] = [redBullRing(), monza(), interlagos()];

export const TRACK_FACTORIES: ReadonlyArray<() => Track> = [
  redBullRing,
  monza,
  interlagos,
];

export function randomTrack(rng: { pick: <T>(arr: readonly T[]) => T }): Track {
  return rng.pick(TRACKS);
}

export function trackById(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}
