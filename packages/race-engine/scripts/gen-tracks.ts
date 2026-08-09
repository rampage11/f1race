import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SegmentKind, TrackSegment } from "../src/types.js";

// Source: TUMFTM/racetrack-database (OSM-derived smoothed centerlines, MIT-style).
// Cloned at: /var/folders/_4/str0ycmx571gn46h2y2c7v6r0000gn/T/opencode/racetrack-db
// CSV: first line `# x_m,y_m,w_tr_right_m,w_tr_left_m`, then rows of meter coords
// ordered in the direction of travel, forming a closed loop (last → first).
const DB_DIR =
  "/var/folders/_4/str0ycmx571gn46h2y2c7v6r0000gn/T/opencode/racetrack-db/tracks";

interface Pt { x: number; y: number; }

interface TrackSpec {
  csv: string;
  exportName: string;
  specLenM: number;
  drsCount: number;
  // Expected race direction computed via shoelace on y-up meter coords:
  // signedArea > 0 => CCW, < 0 => CW. RedBull/Monza run CW, Interlagos CCW.
  expectCw: boolean;
  pretty: string;
}

const TARGET_POINTS = 120;
const CURV_THRESHOLD = 0.0055; // ~180m radius; below = straight
const MIN_SEG_M = 45; // merge segments shorter than this
// Speeds calibrated so baseLapTime (sum len/targetSpeed × 1.05) lands ~78-95s
// at real circuit lengths. Straights: length-tiered 66-76. Corners: inverse-curvature.
const SPEED_MAX = 76;
const SPEED_MIN = 23;
const CORNER_K = 64;
const CORNER_C = 48;

function readCsv(name: string): Pt[] {
  const text = readFileSync(join(DB_DIR, name), "utf8");
  const pts: Pt[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(",");
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts;
}

function closedArcLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function arcResample(pts: Pt[], n: number): Pt[] {
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[cum.length - 1]!;
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1]! < target) i++;
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const segLen = Math.max(1e-9, cum[i + 1]! - cum[i]!);
    const t = (target - cum[i]!) / segLen;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function mengerCurvature(pts: Pt[], idx: number): number {
  const n = pts.length;
  const a = pts[(idx - 1 + n) % n]!;
  const b = pts[idx]!;
  const c = pts[(idx + 1) % n]!;
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  if (ab < 1e-6 || bc < 1e-6 || ca < 1e-6) return 0;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return (4 * area) / (ab * bc * ca);
}

function smooth(arr: number[], radius: number): number[] {
  const n = arr.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let d = -radius; d <= radius; d++) {
      sum += arr[(i + d + n) % n]!;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// Rotate the closed polyline so index 0 = START of the main (longest) straight.
// The real start/finish line sits at the beginning of the main straight on every
// F1 circuit (where cars exit the final corner onto the straight). Because all
// downstream meter positions (segment boundaries, pitEntryS ~0.97*L, pitExitS
// ~0.03*L, DRS zones, sectors) are derived AFTER this rotation, they remain
// consistent with path2D[0] = S/F line. The points are already evenly spaced in
// arc length (arcResample), so rotating the array preserves even spacing exactly.
function rotateToMainStraight(path: Pt[], smoothRadius: number): { path: Pt[]; rotationFrac: number; mainStraightArc: number } {
  const n = path.length;
  const curv = smooth(path.map((_, i) => mengerCurvature(path, i)), smoothRadius);
  // Straight threshold = 25th percentile of curvature (lowest ~25% = straight).
  const sorted = [...curv].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(0.25 * n)]!;
  const total = closedArcLength(path);
  const step = total / n;
  // Find the longest contiguous straight run, measured by ARC LENGTH. A run starts
  // at index i where curv[i] < threshold (straight) and curv[i-1] >= threshold
  // (just exited a corner). Wraparound is handled via the modulo in the run walk.
  let bestArc = -1;
  let bestStart = 0;
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    if (curv[i]! < threshold && curv[prev]! >= threshold) {
      let len = 0;
      let k = i;
      while (len < n && curv[k]! < threshold) {
        len++;
        k = (k + 1) % n;
      }
      const arc = len * step;
      if (arc > bestArc) {
        bestArc = arc;
        bestStart = i;
      }
    }
  }
  const rotationFrac = bestStart / n;
  const rotated = path.slice(bestStart).concat(path.slice(0, bestStart));
  return { path: rotated, rotationFrac, mainStraightArc: Math.max(0, bestArc) };
}

interface BuiltSegment {
  kind: SegmentKind;
  length: number; // meters (unscaled, real arc)
  startS: number; // meters (unscaled)
  avgCurv: number;
}

function buildSegments(path: Pt[]): { segs: BuiltSegment[]; realLen: number } {
  const n = path.length;
  const rawCurv = path.map((_, i) => mengerCurvature(path, i));
  const curv = smooth(rawCurv, 2);
  // Per-point arc spacing (closed)
  const step = closedArcLength(path) / n;

  // Classify points
  const kinds: SegmentKind[] = curv.map((c) => (c < CURV_THRESHOLD ? "straight" : "corner"));

  // Group consecutive same-kind points into segments
  const raw: BuiltSegment[] = [];
  let i = 0;
  while (i < n) {
    const kind = kinds[i]!;
    let j = i;
    let curvSum = 0;
    let count = 0;
    while (j < n && kinds[j] === kind) {
      curvSum += curv[j]!;
      count++;
      j++;
    }
    const length = (j - i) * step;
    raw.push({ kind, length, avgCurv: curvSum / count, startS: i * step });
    i = j;
  }

  // Merge tiny segments into the previous segment (a couple of passes)
  let segs = raw.slice();
  for (let pass = 0; pass < 3; pass++) {
    const merged: BuiltSegment[] = [];
    for (const s of segs) {
      if (merged.length > 0 && s.length < MIN_SEG_M) {
        const prev = merged[merged.length - 1]!;
        prev.length += s.length;
        prev.avgCurv = (prev.avgCurv * 0.5) + (s.avgCurv * 0.5);
      } else {
        merged.push({ ...s });
      }
    }
    segs = merged;
  }
  // Recompute startS sequentially
  let acc = 0;
  for (const s of segs) {
    s.startS = acc;
    acc += s.length;
  }
  return { segs, realLen: acc };
}

function speedFor(avgCurv: number, kind: SegmentKind, length: number): number {
  if (kind === "straight") {
    let v = 70;
    if (length > 700) v = 76;
    else if (length > 450) v = 73;
    else if (length < 250) v = 66;
    return v;
  }
  const v = CORNER_K / (1 + avgCurv * CORNER_C);
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(v)));
}

function overtakeFor(kind: SegmentKind, length: number, avgCurv: number): number {
  if (kind === "straight") {
    return Math.max(0.3, Math.min(1.0, 0.25 + length / 1300));
  }
  return Math.max(0.05, Math.min(0.3, 0.25 - avgCurv * 3));
}

interface FinalTrack {
  path2D: Pt[];
  lengthM: number;
  segments: TrackSegment[];
  drsZones: { startS: number; endS: number }[];
  sectors: number[];
  realArcM: number;
  rotationFrac: number;
  mainStraightArc: number;
}

function buildTrack(spec: TrackSpec): FinalTrack {
  const raw = readCsv(spec.csv);
  let path = arcResample(raw, TARGET_POINTS);

  // Verify / fix travel direction via signed area (y-up meter coords)
  // signedArea > 0 => CCW. expectCw true => want CW => signedArea < 0.
  const area = signedArea(path);
  const isCw = area < 0;
  if (isCw !== spec.expectCw) {
    path = path.reverse();
  }

  // Rotate so index 0 = start of the main straight (the real S/F line). MUST happen
  // before buildSegments so all derived meter positions anchor to path2D[0] = S/F.
  const { path: rotated, rotationFrac, mainStraightArc } = rotateToMainStraight(path, 2);
  path = rotated;

  const { segs, realLen } = buildSegments(path);
  const lengthM = spec.specLenM;
  const scale = lengthM / realLen; // scale segment lengths to sum exactly to spec lengthM

  const segments: TrackSegment[] = segs.map((s) => {
    const len = Math.round(s.length * scale);
    const targetSpeed = speedFor(s.avgCurv, s.kind, s.length);
    const overtaking = Number(overtakeFor(s.kind, s.length, s.avgCurv).toFixed(2));
    return { kind: s.kind, length: len, targetSpeed, overtaking };
  });
  // Force exact sum = lengthM by adjusting the largest segment
  const drift = lengthM - segments.reduce((a, b) => a + b.length, 0);
  if (drift !== 0) {
    let maxIdx = 0;
    for (let k = 1; k < segments.length; k++) if (segments[k]!.length > segments[maxIdx]!.length) maxIdx = k;
    segments[maxIdx]!.length += drift;
  }

  // DRS zones: pick longest straight segments. Compute their [startS,endS] in scaled meters.
  const straights: { startS: number; endS: number; len: number }[] = [];
  let acc = 0;
  for (const s of segments) {
    if (s.kind === "straight") {
      straights.push({ startS: acc, endS: acc + s.length, len: s.length });
    }
    acc += s.length;
  }
  straights.sort((a, b) => b.len - a.len);
  const picked = straights.slice(0, spec.drsCount).sort((a, b) => a.startS - b.startS);
  const drsZones = picked.map((z) => ({ startS: Math.round(z.startS), endS: Math.round(z.endS) }));

  const sectors = [Math.round(lengthM * (1 / 3)), Math.round(lengthM * (2 / 3))];

  return { path2D: path, lengthM, segments, drsZones, sectors, realArcM: Math.round(realLen), rotationFrac, mainStraightArc: Math.round(mainStraightArc) };
}

function fmtPath(path: Pt[]): string {
  const lines: string[] = [];
  for (const p of path) lines.push(`    { x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)} },`);
  return lines.join("\n");
}

function fmtSegments(segs: TrackSegment[]): string {
  const lines: string[] = [];
  for (const s of segs) {
    lines.push(`    { kind: "${s.kind}", length: ${s.length}, targetSpeed: ${s.targetSpeed}, overtaking: ${s.overtaking} },`);
  }
  return lines.join("\n");
}

function fmtDrs(zones: { startS: number; endS: number }[]): string {
  return zones.map((z) => `      { startS: ${z.startS}, endS: ${z.endS} },`).join("\n");
}

const SPECS: TrackSpec[] = [
  { csv: "Spielberg.csv", exportName: "RED_BULL_DATA", specLenM: 4318, drsCount: 3, expectCw: true, pretty: "Red Bull Ring" },
  { csv: "Monza.csv", exportName: "MONZA_DATA", specLenM: 5793, drsCount: 2, expectCw: true, pretty: "Monza" },
  { csv: "SaoPaulo.csv", exportName: "INTERLAGOS_DATA", specLenM: 4309, drsCount: 1, expectCw: false, pretty: "Interlagos" },
];

const built = SPECS.map((s) => ({ spec: s, track: buildTrack(s) }));

// ---- ASCII render for direction/shape verification ----
function render(path: Pt[], name: string): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of path) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  // Terminal chars are ~2:1 (tall). Compensate: cols_per_meter = 2 * rows_per_meter.
  const MAX_COLS = 66;
  const MAX_ROWS = 22;
  const mr = Math.max((2 * bboxW) / MAX_COLS, bboxH / MAX_ROWS); // meters per row
  const mpc = mr / 2; // meters per column
  const cols = Math.max(1, Math.round(bboxW / mpc) + 1);
  const rows = Math.max(1, Math.round(bboxH / mr) + 1);
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const a = path[i]!;
    const col = Math.round((a.x - minX) / mpc);
    const row = Math.round((maxY - a.y) / mr);
    if (row >= 0 && row < rows && col >= 0 && col < cols) {
      grid[row]![col] = i === 0 ? "S" : ".";
    }
  }
  const marks = [Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)];
  for (let m = 0; m < marks.length; m++) {
    const p = path[marks[m]!]!;
    const col = Math.round((p.x - minX) / mpc);
    const row = Math.round((maxY - p.y) / mr);
    if (row >= 0 && row < rows && col >= 0 && col < cols) grid[row]![col] = String(m + 1);
  }
  return `${name} (S=start, 1/2/3=quarter marks, dots=direction):\n` + grid.map((r) => r.join("")).join("\n");
}

// ---- emit data module ----
let out = `// AUTO-GENERATED by scripts/gen-tracks.ts — DO NOT EDIT BY HAND.
// Centerline data: TUMFTM/racetrack-database (OSM-derived centerlines). See scripts/gen-tracks.ts.
import type { TrackSegment } from "./types.js";

export interface TrackData {
  path2D: { x: number; y: number }[];
  lengthM: number;
  segments: TrackSegment[];
  drsZones: { startS: number; endS: number }[];
  sectors: number[];
}
`;

for (const { spec, track } of built) {
  out += `\nexport const ${spec.exportName}: TrackData = {
  path2D: [
${fmtPath(track.path2D)}
  ],
  lengthM: ${track.lengthM},
  segments: [
${fmtSegments(track.segments)}
  ],
  drsZones: [
${fmtDrs(track.drsZones)}
  ],
  sectors: [${track.sectors.join(", ")}],
};
`;
}

writeFileSync(join(process.cwd(), "src/track-data.ts"), out);
console.log("Wrote src/track-data.ts\n");

// ---- report ----
for (const { spec, track } of built) {
  const baseLap = track.segments.reduce((t, s) => t + s.length / s.targetSpeed, 0) * 1.05;
  const segCount = track.segments.length;
  const straightCount = track.segments.filter((s) => s.kind === "straight").length;
  console.log("=".repeat(72));
  console.log(`${spec.pretty}  (${spec.csv})`);
  console.log(`  real arc length: ${track.realArcM} m   |  lengthM (spec): ${track.lengthM} m`);
  console.log(`  path2D points: ${track.path2D.length}   |  segments: ${segCount} (${straightCount} straight)`);
  console.log(`  rotation: ${track.rotationFrac.toFixed(3)} frac (index 0 = start of main straight, ${track.mainStraightArc} m)`);
  console.log(`  baseLapTime: ${baseLap.toFixed(1)} s`);
  console.log(`  DRS zones (${track.drsZones.length}): ` + track.drsZones.map((z) => `[${z.startS}-${z.endS}]`).join(" "));
  console.log(`  sectors: ${track.sectors.join(", ")}`);
  console.log("");
  console.log(render(track.path2D, spec.pretty));
  console.log("");
}
