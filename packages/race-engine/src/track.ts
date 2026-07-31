import type { Track, TrackSegment } from "./types.js";

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
  return {
    id: "red_bull_ring",
    name: "Red Bull Ring",
    country: "AT",
    lengthM: length,
    segments,
    pitLaneDelta: 22,
    pitStopDuration: 3.0,
    pitEntryS: 1000,
    laps: 20,
  };
}
