import type { PathPoint, Point2D, Track, TrackSegment } from "./types.js";

export function trackLengthM(track: Track): number {
  return track.segments.reduce((s, seg) => s + seg.length, 0);
}

export function trackLengthKm(track: Track): number {
  return trackLengthM(track) / 1000;
}

export function segmentIndexAtS(track: Track, s: number): { index: number; offset: number } {
  const total = trackLengthM(track);
  const norm = ((s % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < track.segments.length; i++) {
    const seg = track.segments[i]!;
    if (norm < acc + seg.length) {
      return { index: i, offset: norm - acc };
    }
    acc += seg.length;
  }
  const last = track.segments.length - 1;
  return { index: last, offset: 0 };
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

function seg(
  kind: TrackSegment["kind"],
  length: number,
  targetSpeed: number,
  overtaking: number,
): TrackSegment {
  return { kind, length, targetSpeed, overtaking };
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
  const segments: TrackSegment[] = [
    seg("straight", 1100, 85, 1.0),
    seg("corner", 100, 35, 0.8),
    seg("straight", 380, 78, 0.3),
    seg("corner", 80, 35, 0.5),
    seg("corner", 90, 42, 0.2),
    seg("straight", 450, 75, 0.4),
    seg("corner", 80, 38, 0.2),
    seg("straight", 1100, 88, 1.0),
    seg("corner", 110, 35, 0.7),
    seg("corner", 100, 45, 0.3),
    seg("corner", 90, 40, 0.2),
    seg("straight", 518, 72, 0.5),
  ];
  const length = segments.reduce((s, x) => s + x.length, 0);
  const path2D: Point2D[] = [
    { x: 120, y: 700 },
    { x: 760, y: 760 },
    { x: 860, y: 710 },
    { x: 870, y: 620 },
    { x: 800, y: 560 },
    { x: 720, y: 520 },
    { x: 680, y: 460 },
    { x: 320, y: 420 },
    { x: 230, y: 470 },
    { x: 170, y: 540 },
    { x: 160, y: 620 },
  ];
  return {
    id: "red_bull_ring",
    name: "Red Bull Ring",
    country: "AT",
    lengthM: length,
    segments,
    path2D,
    pitLaneDelta: 22,
    pitStopDuration: 3.0,
    pitEntryS: 1000,
    laps: 20,
  };
}
