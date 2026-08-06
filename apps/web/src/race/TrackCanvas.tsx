import { useEffect, useMemo, useRef } from "react";
import {
  pathBounds,
  pathCumulative,
  pathPointAt,
  redBullRing,
} from "@f1race/race-engine";
import type { SessionCar, SessionSnapshot } from "./useRaceSession";
import { teamColor, TYRE_COLORS } from "./colors";

const W = 940;
const H = 620;
const PAD = 36;
const DOT_R = 9;
// Render this far behind "now" (ms) so there is always a pair of snapshots to interpolate
// between. ~1.5x the ~100ms server tick keeps a safe bracket under normal jitter; reaction
// fairness is server-side and the lights overlay is a sibling component, so this lag never
// affects the start mini-game.
const RENDER_DELAY_MS = 150;
const RING_SIZE = 4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Wrap-aware fractional lerp along the lap. sFraction is 0..1 and wraps through the S/F line,
// so 0.99 -> 0.02 must travel FORWARD across the line (Δ = +0.03 mod 1), not backward over the
// whole track.
function fracLerp(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 0.5) d -= 1;
  else if (d < -0.5) d += 1;
  let f = a + d * t;
  if (f < 0) f += 1;
  if (f >= 1) f -= 1;
  return f;
}

interface Geom {
  track: ReturnType<typeof redBullRing>;
  path: ReturnType<typeof redBullRing>["path2D"];
  cum: ReturnType<typeof pathCumulative>;
  bounds: ReturnType<typeof pathBounds>;
  lengthM: number;
}

interface Pt {
  x: number;
  y: number;
  angle: number;
}

interface Painters {
  sx: (x: number) => number;
  sy: (y: number) => number;
  toScreen: (frac: number) => Pt;
  entryPt: Pt;
  exitPt: Pt;
  pitA: { x: number; y: number };
  pitB: { x: number; y: number };
  inEntry: { x: number; y: number };
  pitDelta: number;
  LANE: number;
}

function buildPainters(g: Geom): Painters {
  const { path, cum, bounds, lengthM, track } = g;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2 - bounds.minX * scale;
  const offY = (H - spanY * scale) / 2 - bounds.minY * scale;
  const sx = (x: number) => offX + x * scale;
  const sy = (y: number) => offY + y * scale;
  const toScreen = (frac: number): Pt => {
    const p = pathPointAt(path, cum, frac);
    return { x: sx(p.x), y: sy(p.y), angle: p.angle };
  };
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const LANE = 42;
  const infieldOffset = (p: Pt) => {
    let nx = -Math.sin(p.angle);
    let ny = Math.cos(p.angle);
    if (nx * (center.x - p.x) + ny * (center.y - p.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: nx * LANE, y: ny * LANE };
  };
  const entryPt = pathPointAt(path, cum, track.pitEntryS / lengthM);
  const exitPt = pathPointAt(path, cum, track.pitExitS / lengthM);
  const inEntry = infieldOffset(entryPt);
  const inExit = infieldOffset(exitPt);
  const pitA = { x: entryPt.x + inEntry.x, y: entryPt.y + inEntry.y };
  const pitB = { x: exitPt.x + inExit.x, y: exitPt.y + inExit.y };
  return { sx, sy, toScreen, entryPt, exitPt, pitA, pitB, inEntry, pitDelta: track.pitLaneDelta, LANE };
}

function drawStatic(ctx: CanvasRenderingContext2D, g: Geom, p: Painters): void {
  const { path } = g;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);

  const drawTrace = (width: number, color: string) => {
    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const pt = path[i]!;
      const x = p.sx(pt.x);
      const y = p.sy(pt.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  };
  drawTrace(34, "#1f2937");
  drawTrace(26, "#334155");

  const sf = pathPointAt(path, g.cum, 0);
  ctx.save();
  ctx.translate(p.sx(sf.x), p.sy(sf.y));
  ctx.rotate(sf.angle + Math.PI / 2);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(-16, -3, 32, 6);
  ctx.restore();

  const drawLane = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    ctx.beginPath();
    ctx.moveTo(p.sx(from.x), p.sy(from.y));
    ctx.lineTo(p.sx(to.x), p.sy(to.y));
    ctx.lineCap = "round";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#243049";
    ctx.stroke();
  };
  drawLane(p.pitA, p.pitB);
  drawLane(p.entryPt, p.pitA);
  drawLane(p.pitB, p.exitPt);
  ctx.beginPath();
  ctx.moveTo(p.sx(p.pitA.x), p.sy(p.pitA.y));
  ctx.lineTo(p.sx(p.pitB.x), p.sy(p.pitB.y));
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "#64748b";
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 8; i++) {
    const f = i / 7;
    const px = p.pitA.x + (p.pitB.x - p.pitA.x) * f + p.inEntry.x * 0.25;
    const py = p.pitA.y + (p.pitB.y - p.pitA.y) * f + p.inEntry.y * 0.25;
    ctx.fillStyle = "#334155";
    ctx.fillRect(p.sx(px) - 4, p.sy(py) - 4, 8, 8);
  }
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(p.sx(p.entryPt.x), p.sy(p.entryPt.y), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.sx(p.exitPt.x), p.sy(p.exitPt.y), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.fillText("PIT IN", p.sx(p.entryPt.x) + 8, p.sy(p.entryPt.y) - 6);
  ctx.fillText("PIT OUT", p.sx(p.exitPt.x) + 8, p.sy(p.exitPt.y) - 6);
}

// Screen position for a car in the pit lane, parameterised by an (interpolatable) pitTimer.
// Same piecewise entry→box→exit path as the original; lerping pitTimer between snapshots
// smooths the slow pit crawl instead of snapping it at 10 Hz.
function pitPos(pitTimer: number, gridPosition: number, p: Painters): { x: number; y: number } {
  const g = p.pitDelta > 0 ? clamp01(1 - pitTimer / p.pitDelta) : 1;
  const shift = ((gridPosition % 3) - 1) * 3;
  const sxOff = p.inEntry.x * (shift / p.LANE);
  const syOff = p.inEntry.y * (shift / p.LANE);
  let fx: number;
  let fy: number;
  if (g < 0.15) {
    const t = g / 0.15;
    fx = lerp(p.entryPt.x, p.pitA.x, t);
    fy = lerp(p.entryPt.y, p.pitA.y, t);
  } else if (g < 0.85) {
    let lf = (g - 0.15) / 0.7;
    if (lf > 0.42 && lf < 0.58) lf = 0.5;
    else if (lf <= 0.42) lf = (lf / 0.42) * 0.5;
    else lf = 0.5 + ((lf - 0.58) / 0.42) * 0.5;
    fx = lerp(p.pitA.x, p.pitB.x, lf);
    fy = lerp(p.pitA.y, p.pitB.y, lf);
  } else {
    const t = (g - 0.85) / 0.15;
    fx = lerp(p.pitB.x, p.entryPt.x, t);
    fy = lerp(p.pitB.y, p.entryPt.y, t);
  }
  return { x: p.sx(fx + sxOff), y: p.sy(fy + syOff) };
}

interface Sample {
  a: SessionSnapshot;
  b: SessionSnapshot;
  t: number;
}

// Pick the pair of buffered snapshots that bracket renderTime, and the interpolation factor
// between them. Falls back to the oldest (snap) before the buffer fills, and to bounded
// extrapolation from the last two when a snapshot is briefly late.
function samplePair(ring: { snap: SessionSnapshot; t: number }[], renderTime: number): Sample | null {
  const n = ring.length;
  if (n === 0) return null;
  if (n === 1) return { a: ring[0]!.snap, b: ring[0]!.snap, t: 0 };
  for (let k = 0; k < n - 1; k++) {
    const lo = ring[k]!;
    const hi = ring[k + 1]!;
    if (lo.t <= renderTime && renderTime < hi.t) {
      const dt = hi.t - lo.t || 1;
      return { a: lo.snap, b: hi.snap, t: clamp01((renderTime - lo.t) / dt) };
    }
  }
  if (renderTime < ring[0]!.t) return { a: ring[0]!.snap, b: ring[0]!.snap, t: 0 };
  const prev = ring[n - 2]!;
  const last = ring[n - 1]!;
  const dt = last.t - prev.t || 1;
  let t = (renderTime - prev.t) / dt;
  if (t > 2.5) t = 2.5;
  return { a: prev.snap, b: last.snap, t };
}

interface CarPos {
  x: number;
  y: number;
  angle?: number;
  lateral: number;
  inPits: boolean;
}

// Resolve a single car's interpolated render state. Only sFraction (racing) and pitTimer
// (in pits) are interpolated; on a pit↔track transition the two coordinate systems don't
// blend, so we snap to the newer side for that frame.
function carPos(car: SessionCar, older: SessionCar | undefined, t: number, p: Painters): CarPos {
  if (older && !car.inPits && !older.inPits) {
    const frac = fracLerp(older.sFraction, car.sFraction, t);
    const sp = p.toScreen(frac);
    return { x: sp.x, y: sp.y, angle: sp.angle, lateral: lerp(older.lateral ?? 0, car.lateral ?? 0, t), inPits: false };
  }
  if (older && car.inPits && older.inPits) {
    const pt = pitPos(lerp(older.pitTimer ?? 0, car.pitTimer ?? 0, t), older.gridPosition ?? car.gridPosition ?? 1, p);
    return { x: pt.x, y: pt.y, lateral: 0, inPits: true };
  }
  if (car.inPits) {
    const pt = pitPos(car.pitTimer ?? 0, car.gridPosition ?? 1, p);
    return { x: pt.x, y: pt.y, lateral: 0, inPits: true };
  }
  const sp = p.toScreen(car.sFraction);
  return { x: sp.x, y: sp.y, angle: sp.angle, lateral: car.lateral ?? 0, inPits: false };
}

function drawCars(ctx: CanvasRenderingContext2D, sample: Sample, heroId: string, p: Painters): void {
  const { a, b, t } = sample;
  const olderById = new Map<string, SessionCar>();
  for (const c of a.cars) olderById.set(c.driverId, c);

  let heroPos: CarPos | null = null;

  for (const car of b.cars) {
    const older = olderById.get(car.driverId);
    const pos = carPos(car, older, t, p);
    if (car.driverId === heroId) heroPos = pos;

    const r = DOT_R;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = car.finished ? "#334155" : teamColor(car.team);
    ctx.fill();
    ctx.lineWidth = car.driverId === heroId ? 3 : 1;
    ctx.strokeStyle = car.driverId === heroId ? "#fde047" : "#0b1220";
    ctx.stroke();

    const lat = pos.lateral;
    if (typeof pos.angle === "number" && lat > 0.05 && !pos.inPits) {
      const off = lat * 16;
      const lx = pos.x + -Math.sin(pos.angle) * off;
      const ly = pos.y + Math.cos(pos.angle) * off;
      ctx.beginPath();
      ctx.arc(lx, ly, r * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = car.finished ? "#334155" : teamColor(car.team);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#0b1220";
      ctx.stroke();
    }

    if (car.tyreCompound) {
      const coreX = lat > 0.05 && typeof pos.angle === "number" && !pos.inPits
        ? pos.x + -Math.sin(pos.angle) * lat * 16
        : pos.x;
      const coreY = lat > 0.05 && typeof pos.angle === "number" && !pos.inPits
        ? pos.y + Math.cos(pos.angle) * lat * 16
        : pos.y;
      ctx.beginPath();
      ctx.arc(coreX, coreY, 3, 0, Math.PI * 2);
      ctx.fillStyle = TYRE_COLORS[car.tyreCompound];
      ctx.fill();
    }

    if (car.blueFlag) {
      ctx.fillStyle = "#3b82f6";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText("🔵", pos.x - 5, pos.y - 12);
    }
  }

  const hero = b.cars.find((c) => c.driverId === heroId);
  if (hero && heroPos && !heroPos.inPits && b.stage === "race") {
    ctx.fillStyle = "#fde047";
    ctx.font = "bold 12px system-ui, sans-serif";
    const tag = hero.position != null ? `P${hero.position} ` : "";
    ctx.fillText(`${tag}${hero.name}`, heroPos.x + 12, heroPos.y - 10);
  }
}

export function TrackCanvas({ snapshot, heroId }: { snapshot: SessionSnapshot | null; heroId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const geom = useMemo<Geom>(() => {
    const track = redBullRing();
    const path = track.path2D;
    return { track, path, cum: pathCumulative(path), bounds: pathBounds(path), lengthM: track.lengthM };
  }, []);
  const painters = useMemo<Painters>(() => buildPainters(geom), [geom]);

  const staticRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const ctx = off.getContext("2d");
    if (!ctx) {
      staticRef.current = null;
      return;
    }
    drawStatic(ctx, geom, painters);
    staticRef.current = off;
  }, [geom, painters]);

  const ringRef = useRef<{ snap: SessionSnapshot; t: number }[]>([]);
  useEffect(() => {
    if (!snapshot) return;
    const ring = ringRef.current;
    ring.push({ snap: snapshot, t: performance.now() });
    if (ring.length > RING_SIZE) ring.shift();
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const off = staticRef.current;
      ctx.clearRect(0, 0, W, H);
      if (off) {
        ctx.drawImage(off, 0, 0);
      } else {
        ctx.fillStyle = "#0b1220";
        ctx.fillRect(0, 0, W, H);
      }
      const ring = ringRef.current;
      if (ring.length === 0) return;
      const sample = samplePair(ring, performance.now() - RENDER_DELAY_MS);
      if (!sample) return;
      drawCars(ctx, sample, heroId, painters);
      const lapInfo = sample.b.totalLaps ? ` · ${sample.b.totalLaps} кругов` : "";
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(`${geom.track.name}${lapInfo}`, 12, H - 12);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [geom, painters, heroId]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ width: "100%", maxWidth: W, height: "auto", borderRadius: 12, background: "#0b1220" }}
    />
  );
}
