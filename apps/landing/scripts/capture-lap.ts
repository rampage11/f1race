import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pathBounds,
  pathCumulative,
  redBullRing,
  trackLengthM,
  segmentIndexAtS,
  type Point2D,
  type TrackSegment,
} from "../../../packages/race-engine/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../src/data/lap.json");

const N = 360;
const SMOOTH_HALF_M = 55;

const track = redBullRing();
const lengthM = trackLengthM(track);
const path = track.path2D;
const cum = pathCumulative(path);
const bounds = pathBounds(path);

function rawSpeedAt(distanceM: number): number {
  const { index } = segmentIndexAtS(track, distanceM);
  const seg = track.segments[index];
  return seg ? seg.targetSpeed : 0;
}

function smoothedSpeedAt(distanceM: number): number {
  let acc = 0;
  let wsum = 0;
  for (let off = -SMOOTH_HALF_M; off <= SMOOTH_HALF_M; off += 5) {
    const d = distanceM + off;
    const w = 1 - Math.abs(off) / (SMOOTH_HALF_M + 1);
    acc += rawSpeedAt(d) * w;
    wsum += w;
  }
  return wsum > 0 ? acc / wsum : rawSpeedAt(distanceM);
}

const speed: { dM: number; kmh: number }[] = [];
let speedMin = Infinity;
let speedMax = -Infinity;
for (let i = 0; i < N; i++) {
  const dM = (i / N) * lengthM;
  const ms = smoothedSpeedAt(dM);
  const kmh = ms * 3.6;
  speed.push({ dM: Math.round(dM), kmh: Math.round(kmh * 10) / 10 });
  if (kmh < speedMin) speedMin = kmh;
  if (kmh > speedMax) speedMax = kmh;
}

const data = {
  trackId: track.id,
  trackName: track.name,
  lengthM,
  bounds,
  path: path as Point2D[],
  cum,
  speed,
  speedMin: Math.round(speedMin * 10) / 10,
  speedMax: Math.round(speedMax * 10) / 10,
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");

void (null as unknown as TrackSegment);

console.log(
  `captured ${N} samples over ${Math.round(lengthM)}m → ${outPath}\n` +
    `speed ${speedMin.toFixed(1)}–${speedMax.toFixed(1)} km/h`,
);
