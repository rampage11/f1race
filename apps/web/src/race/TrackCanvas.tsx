import { useEffect, useMemo, useRef } from "react";
import {
  pathBounds,
  pathCumulative,
  pathPointAt,
  redBullRing,
  trackById,
} from "@f1race/race-engine";
import type { Point2D, TimeOfDay, Track, Weather } from "@f1race/race-engine";
import type { SessionCar, SessionSnapshot, Stage } from "./useRaceSession";
import { teamColor, TYRE_COLORS } from "./colors";
import { SCENERY, sceneryAssetUrl, type SceneryEntry, type SceneryKind } from "./scenery";

const W = 940;
const H = 620;
const PAD = 36;
// Render this far behind "now" (ms) so there is always a pair of snapshots to interpolate
// between. ~1.5x the ~100ms server tick keeps a safe bracket under normal jitter; reaction
// fairness is server-side and the lights overlay is a sibling component, so this lag never
// affects the start mini-game.
const RENDER_DELAY_MS = 150;
const RING_SIZE = 4;

const CAR_LEN = 24;
const CAR_W = 12;
const MARK_TTL_MS = 5000;
const MARK_MAX_PER_CAR = 7;
const SPARK_MAX = 170;
const SPARK_LIFE_MS = 220;
const RAIN_LIGHT = 130;
const RAIN_HEAVY = 300;

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
  track: Track;
  path: Point2D[];
  cum: number[];
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

interface Palette {
  bg: string;
  grass: string;
  gravel: string;
  asphalt: string;
  kerb: string;
  accent: string;
}

function paletteFor(trackId: string | undefined): Palette {
  switch (trackId) {
    case "monza":
      return { bg: "#0a0a0f", grass: "#3a5c2a", gravel: "#5c4a2a", asphalt: "#2a2a35", kerb: "#cc0000", accent: "#c4a77d" };
    case "interlagos":
      return { bg: "#0a0a0f", grass: "#1a5c2e", gravel: "#5c4a2a", asphalt: "#2f2f3a", kerb: "#cc0000", accent: "#ff6600" };
    case "red_bull_ring":
    default:
      return { bg: "#0a0a0f", grass: "#0d5c3b", gravel: "#4a3a2a", asphalt: "#2a2a35", kerb: "#cc0000", accent: "#0d5c3b" };
  }
}

function isRainy(w?: Weather): w is "lightRain" | "heavyRain" {
  return w === "lightRain" || w === "heavyRain";
}

function tracePolyline(g: Geom, p: Painters, startFrac: number, endFrac: number, steps: number, ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const f = lerp(startFrac, endFrac, i / steps);
    const pt = p.toScreen(f);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
}

// Catmull-Rom → cubic-bezier smoothed closed Path2D through world-space points
// transformed to screen space via `tx`/`ty`. Generic for any point count ≥ 3.
// `tension` ∈ [0,1]; 0.5 = standard Catmull-Rom (smooth, no overshoot).
function buildSmoothPath(
  points: Point2D[],
  tx: (x: number) => number,
  ty: (y: number) => number,
  tension = 0.5,
): Path2D {
  const path = new Path2D();
  const n = points.length;
  if (n === 0) return path;
  if (n < 3) {
    const p0 = points[0]!;
    path.moveTo(tx(p0.x), ty(p0.y));
    for (let i = 1; i < n; i++) {
      path.lineTo(tx(points[i]!.x), ty(points[i]!.y));
    }
    path.closePath();
    return path;
  }
  const k = (1 - tension) / 3;
  const first = points[0]!;
  path.moveTo(tx(first.x), ty(first.y));
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) * k;
    const c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k;
    const c2y = p2.y - (p3.y - p1.y) * k;
    path.bezierCurveTo(tx(c1x), ty(c1y), tx(c2x), ty(c2y), tx(p2.x), ty(p2.y));
  }
  path.closePath();
  return path;
}

// Lazy PNG cache for scenery sprites. Loads async on first reference; until
// complete, drawStatic falls back to the vector stand-in. A subsequent static
// rebuild (geom/weather/tod change) will pick up the loaded image.
const sceneryImageCache = new Map<string, HTMLImageElement>();
function getCachedSceneryImage(asset: string): HTMLImageElement | null {
  let img = sceneryImageCache.get(asset);
  if (!img) {
    img = new Image();
    img.src = sceneryAssetUrl(asset);
    sceneryImageCache.set(asset, img);
  }
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

function isBackgroundKind(kind: SceneryKind): boolean {
  return kind === "hill" || kind === "sea" || kind === "yacht";
}

// Anchor a scenery entry in screen space: ride the path at entry.s, then step
// perpendicular to the tangent by `dist` pixels toward side.
function anchorScenery(entry: SceneryEntry, p: Painters): { x: number; y: number; angle: number } {
  const pt = p.toScreen(entry.s);
  const nx = -Math.sin(pt.angle);
  const ny = Math.cos(pt.angle);
  const sign = entry.side === "left" ? 1 : -1;
  return { x: pt.x + nx * entry.dist * sign, y: pt.y + ny * entry.dist * sign, angle: pt.angle };
}

const CROWD_COLORS = ["#f97316", "#fbbf24", "#ef4444", "#3b82f6", "#22c55e"];

function drawSceneryStandIn(
  ctx: CanvasRenderingContext2D,
  kind: SceneryKind,
  x: number,
  y: number,
  angle: number,
  scale: number,
  night: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  switch (kind) {
    case "tree": {
      ctx.fillStyle = night ? "#2a1e10" : "#5b3a1a";
      ctx.fillRect(-1.5 * scale, 0, 3 * scale, 6 * scale);
      ctx.fillStyle = night ? "#0d2218" : "#1e5128";
      ctx.beginPath();
      ctx.arc(0, -4 * scale, 7 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = night ? "#10301f" : "#267a3a";
      ctx.beginPath();
      ctx.arc(-2 * scale, -6 * scale, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "cypress": {
      ctx.fillStyle = night ? "#0d1f15" : "#1a3a22";
      ctx.beginPath();
      ctx.moveTo(0, -24 * scale);
      ctx.lineTo(5 * scale, 0);
      ctx.lineTo(-5 * scale, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = night ? "#132a1c" : "#234a2c";
      ctx.beginPath();
      ctx.moveTo(0, -24 * scale);
      ctx.lineTo(2.5 * scale, -8 * scale);
      ctx.lineTo(-2.5 * scale, -8 * scale);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "grandstand": {
      const w = 56 * scale;
      const h = 16 * scale;
      ctx.fillStyle = night ? "#15151d" : "#3a3a48";
      ctx.fillRect(-w / 2, -h, w, h);
      ctx.fillStyle = night ? "#0a0a12" : "#4a4a58";
      ctx.fillRect(-w / 2, -h, w, 2.5);
      ctx.fillStyle = night ? "#202028" : "#2a2a34";
      ctx.fillRect(-w / 2, -2, w, 2);
      if (!night) {
        const cols = Math.max(4, Math.floor(w / 5));
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = CROWD_COLORS[(c + r) % CROWD_COLORS.length]!;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(-w / 2 + 2 + c * (w - 4) / cols, -h + 4 + r * 3.5, (w - 4) / cols - 1, 2.5);
          }
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "wall": {
      ctx.rotate(angle);
      const w = 34 * scale;
      const h = 5 * scale;
      ctx.fillStyle = night ? "#26262c" : "#d4c8b8";
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = night ? "#161620" : "#9a8e7e";
      ctx.fillRect(-w / 2, -h / 2, w, 1.5);
      ctx.fillStyle = night ? "#3a2a1a" : "#cc0000";
      ctx.fillRect(-w / 2, -h / 2 - 1.5, w, 1.5);
      break;
    }
    case "building": {
      const w = 24 * scale;
      const h = 22 * scale;
      ctx.fillStyle = night ? "#1a1a24" : "#d4c8b8";
      ctx.fillRect(-w / 2, -h, w, h);
      ctx.fillStyle = night ? "#0e0e16" : "#b0a090";
      ctx.fillRect(-w / 2, -h, w, 2);
      ctx.fillStyle = night ? "#5a5a3a" : "#7a90a8";
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          if (night && (r + c) % 2 === 1) continue;
          ctx.globalAlpha = night ? 0.9 : 0.75;
          ctx.fillRect(-w / 2 + 4 + c * 11, -h + 5 + r * 4.5, 6, 3);
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "yacht": {
      const w = 32 * scale;
      const h = 9 * scale;
      ctx.fillStyle = night ? "#3a3a42" : "#f0f0f0";
      roundRectPath(ctx, -w / 2, -h / 2, w, h, h / 2);
      ctx.fill();
      ctx.strokeStyle = night ? "#1a1a20" : "#666666";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(0, -h / 2 - 14 * scale);
      ctx.stroke();
      ctx.fillStyle = night ? "rgba(180,200,220,0.4)" : "rgba(220,235,250,0.7)";
      ctx.beginPath();
      ctx.moveTo(0, -h / 2 - 14 * scale);
      ctx.lineTo(8 * scale, -h / 2 - 4 * scale);
      ctx.lineTo(0, -h / 2 - 4 * scale);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "sea": {
      const r = 42 * scale;
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, r);
      grad.addColorStop(0, night ? "rgba(40,70,110,0.55)" : "rgba(74,127,181,0.6)");
      grad.addColorStop(0.7, night ? "rgba(30,55,85,0.35)" : "rgba(110,170,210,0.4)");
      grad.addColorStop(1, "rgba(135,206,235,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "hill": {
      const w = 100 * scale;
      const h = 36 * scale;
      ctx.fillStyle = night ? "#0a1410" : "#1a4a28";
      ctx.beginPath();
      ctx.moveTo(-w / 2, 8);
      ctx.quadraticCurveTo(-w / 4, -h, 0, -h * 0.7);
      ctx.quadraticCurveTo(w / 4, -h * 0.4, w / 2, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = night ? "#0e1c14" : "#236035";
      ctx.beginPath();
      ctx.moveTo(-w / 3, 8);
      ctx.quadraticCurveTo(-w / 6, -h * 0.6, w / 6, -h * 0.5);
      ctx.quadraticCurveTo(w / 3, -h * 0.45, w / 2.4, 8);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "barrier": {
      ctx.rotate(angle);
      const w = 26 * scale;
      ctx.fillStyle = night ? "#1a1a22" : "#2e2e3a";
      for (let i = 0; i < 5; i++) {
        const cx = -w / 2 + 2 + (i * (w - 4)) / 4;
        ctx.beginPath();
        ctx.arc(cx, 0, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = night ? "#0e0e16" : "#5a5a66";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -1.5);
      ctx.lineTo(w / 2, -1.5);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// Render all scenery entries for the current track whose kind matches `layer`
// ("background" → before surface; "foreground" → after surface). Sprites take
// over when their PNG is loaded; otherwise the vector stand-in is drawn.
function drawScenery(ctx: CanvasRenderingContext2D, trackId: string, p: Painters, tod: TimeOfDay | undefined, layer: "background" | "foreground"): void {
  const entries = SCENERY[trackId];
  if (!entries || entries.length === 0) return;
  const night = tod === "night";
  for (const e of entries) {
    const isBg = isBackgroundKind(e.kind);
    if (layer === "background" && !isBg) continue;
    if (layer === "foreground" && isBg) continue;
    const a = anchorScenery(e, p);
    const scale = e.scale ?? 1;
    if (e.asset) {
      const img = getCachedSceneryImage(e.asset);
      if (img) {
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, a.x - dw / 2, a.y - dh, dw, dh);
        continue;
      }
    }
    drawSceneryStandIn(ctx, e.kind, a.x, a.y, a.angle, scale, night);
  }
}

// Checkered start/finish band perpendicular to travel at s=0.
function drawStartFinish(ctx: CanvasRenderingContext2D, p: Painters): void {
  const pt = p.toScreen(0);
  const trackWidth = 26;
  const cols = 9;
  const rows = 2;
  const cellW = trackWidth / cols;
  const cellH = 3.2;
  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(pt.angle);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isWhite = (r + c) % 2 === 0;
      ctx.fillStyle = isWhite ? "#f8fafc" : "#0a0a0f";
      ctx.fillRect(-cellH + r * cellH, -trackWidth / 2 + c * cellW, cellH, cellW);
    }
  }
  ctx.restore();
}

// F1-style staggered 2×N grid behind the S/F line. Pure decoration.
function drawStartGrid(ctx: CanvasRenderingContext2D, p: Painters, count: number): void {
  const SPACING_FRAC = 0.0019;
  const LATERAL = 7;
  const BOX_X = 13;
  const BOX_Y = 8;
  for (let i = 0; i < count; i++) {
    const f = -(i + 0.5) * SPACING_FRAC;
    const pt = p.toScreen(f);
    const side = i % 2 === 0 ? 1 : -1;
    const nx = -Math.sin(pt.angle);
    const ny = Math.cos(pt.angle);
    ctx.save();
    ctx.translate(pt.x + nx * LATERAL * side, pt.y + ny * LATERAL * side);
    ctx.rotate(pt.angle);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-BOX_X / 2, -BOX_Y / 2, BOX_X, BOX_Y);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(-BOX_X / 2, -BOX_Y / 2, BOX_X, BOX_Y);
    ctx.restore();
  }
}

function drawStatic(
  ctx: CanvasRenderingContext2D,
  g: Geom,
  p: Painters,
  pal: Palette,
  effWeather: Weather | undefined,
  tod: TimeOfDay | undefined,
  stage: Stage | undefined,
): void {
  const rainy = isRainy(effWeather);
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // Background scenery (hills, sea, yachts) sits BEHIND the surface so the
  // asphalt overlaps its base — creates depth.
  drawScenery(ctx, g.track.id, p, tod, "background");

  // Smoothed closed path; reused for every concentric surface stroke.
  const smooth = buildSmoothPath(g.path, p.sx, p.sy);
  const BASE = 28;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Grass apron (widest)
  ctx.lineWidth = BASE * 2.4;
  ctx.strokeStyle = pal.grass;
  ctx.stroke(smooth);
  // Runoff / gravel
  ctx.lineWidth = BASE * 1.6;
  ctx.strokeStyle = pal.gravel;
  ctx.stroke(smooth);
  // Kerb — red/white dashes (stroke twice with offset dash pattern)
  ctx.lineWidth = BASE * 1.18;
  ctx.setLineDash([18, 18]);
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = pal.kerb;
  ctx.stroke(smooth);
  ctx.lineDashOffset = 18;
  ctx.strokeStyle = "#f8fafc";
  ctx.stroke(smooth);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  // Asphalt (innermost)
  ctx.lineWidth = BASE;
  ctx.strokeStyle = pal.asphalt;
  ctx.stroke(smooth);

  if (rainy) {
    ctx.lineWidth = BASE;
    ctx.strokeStyle = "rgba(90,110,140,0.12)";
    ctx.stroke(smooth);
  }

  // Foreground scenery (trees, walls, grandstands, buildings, barriers) on top
  // of the surface edge.
  drawScenery(ctx, g.track.id, p, tod, "foreground");

  for (const z of g.track.drsZones) {
    const sf = z.startS / g.lengthM;
    const ef = z.endS / g.lengthM;
    tracePolyline(g, p, sf, ef, 30, ctx);
    ctx.lineWidth = 28;
    ctx.strokeStyle = "rgba(0,210,106,0.08)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    tracePolyline(g, p, sf, ef, 30, ctx);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,210,106,0.55)";
    ctx.stroke();
  }

  const sectorColors = ["#0a84ff", "#bf5af2", "#00d26a"];
  const boundaries = [g.track.sectors[0]! / g.lengthM, g.track.sectors[1]! / g.lengthM, 0];
  for (let i = 0; i < boundaries.length; i++) {
    const f = boundaries[i]!;
    const pt = p.toScreen(f);
    const nx = -Math.sin(pt.angle);
    const ny = Math.cos(pt.angle);
    const half = 17;
    ctx.beginPath();
    ctx.moveTo(pt.x - nx * half, pt.y - ny * half);
    ctx.lineTo(pt.x + nx * half, pt.y + ny * half);
    ctx.lineWidth = 2;
    ctx.strokeStyle = sectorColors[i]!;
    ctx.stroke();
  }

  drawStartFinish(ctx, p);

  if (stage === "race" || stage === "finished") {
    drawStartGrid(ctx, p, 14);
  }

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
}

// Screen position for a car in the pit lane, parameterised by an (interpolatable) pitTimer.
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
    fx = lerp(p.pitB.x, p.exitPt.x, t);
    fy = lerp(p.pitB.y, p.exitPt.y, t);
  }
  return { x: p.sx(fx + sxOff), y: p.sy(fy + syOff) };
}

interface Sample {
  a: SessionSnapshot;
  b: SessionSnapshot;
  t: number;
}

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
  angle: number;
  lateral: number;
  inPits: boolean;
}

function carPos(car: SessionCar, older: SessionCar | undefined, t: number, p: Painters): CarPos {
  if (older && !car.inPits && !older.inPits) {
    const frac = fracLerp(older.sFraction, car.sFraction, t);
    const sp = p.toScreen(frac);
    return { x: sp.x, y: sp.y, angle: sp.angle, lateral: lerp(older.lateral ?? 0, car.lateral ?? 0, t), inPits: false };
  }
  if (older && car.inPits && older.inPits) {
    const pt = pitPos(lerp(older.pitTimer ?? 0, car.pitTimer ?? 0, t), older.gridPosition ?? car.gridPosition ?? 1, p);
    return { x: pt.x, y: pt.y, angle: 0, lateral: 0, inPits: true };
  }
  if (car.inPits) {
    const pt = pitPos(car.pitTimer ?? 0, car.gridPosition ?? 1, p);
    return { x: pt.x, y: pt.y, angle: 0, lateral: 0, inPits: true };
  }
  const sp = p.toScreen(car.sFraction);
  return { x: sp.x, y: sp.y, angle: sp.angle, lateral: car.lateral ?? 0, inPits: false };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
  color: string;
  size: number;
}

interface RainDrop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

interface TrackCanvasProps {
  snapshot: SessionSnapshot | null;
  heroId: string;
  trackId?: string;
  weather?: Weather;
  timeOfDay?: TimeOfDay;
}

export function TrackCanvas({ snapshot, heroId, trackId, weather, timeOfDay }: TrackCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const geom = useMemo<Geom>(() => {
    const track = (trackId ? trackById(trackId) : undefined) ?? redBullRing();
    const path = track.path2D;
    return { track, path, cum: pathCumulative(path), bounds: pathBounds(path), lengthM: track.lengthM };
  }, [trackId]);
  const painters = useMemo<Painters>(() => buildPainters(geom), [geom]);
  const palette = useMemo<Palette>(() => paletteFor(geom.track.id), [geom]);

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
    drawStatic(ctx, geom, painters, palette, weather, timeOfDay, snapshot?.stage);
    staticRef.current = off;
  }, [geom, painters, palette, weather, timeOfDay, snapshot?.stage]);

  const ringRef = useRef<{ snap: SessionSnapshot; t: number }[]>([]);
  useEffect(() => {
    if (!snapshot) return;
    const ring = ringRef.current;
    ring.push({ snap: snapshot, t: performance.now() });
    if (ring.length > RING_SIZE) ring.shift();
  }, [snapshot]);

  const marksRef = useRef<Map<string, { x: number; y: number; t: number }[]>>(new Map());
  const sparksRef = useRef<Spark[]>([]);
  const rainRef = useRef<RainDrop[] | null>(null);
  const lastFrameRef = useRef<number>(performance.now());

  useEffect(() => {
    marksRef.current.clear();
    sparksRef.current = [];
    rainRef.current = null;
  }, [geom]);

  const heroIdRef = useRef(heroId);
  heroIdRef.current = heroId;
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const todRef = useRef(timeOfDay);
  todRef.current = timeOfDay;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const ensureRain = (w: Weather | undefined): RainDrop[] => {
      const existing = rainRef.current;
      const want = w === "heavyRain" ? RAIN_HEAVY : w === "lightRain" ? RAIN_LIGHT : 0;
      if (existing && existing.length === want) return existing;
      const drops: RainDrop[] = [];
      for (let i = 0; i < want; i++) {
        drops.push({
          x: Math.random() * W,
          y: Math.random() * H,
          len: 8 + Math.random() * 8,
          speed: 360 + Math.random() * 120,
        });
      }
      rainRef.current = drops;
      return drops;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      const off = staticRef.current;
      ctx.clearRect(0, 0, W, H);
      if (off) {
        ctx.drawImage(off, 0, 0);
      } else {
        ctx.fillStyle = "#0b1220";
        ctx.fillRect(0, 0, W, H);
      }

      const ring = ringRef.current;
      if (ring.length === 0) {
        drawHud(ctx, geom, "");
        return;
      }
      const sample = samplePair(ring, now - RENDER_DELAY_MS);
      if (!sample) {
        drawHud(ctx, geom, "");
        return;
      }

      const { a, b, t } = sample;
      const olderById = new Map<string, SessionCar>();
      for (const c of a.cars) olderById.set(c.driverId, c);
      const positions = new Map<string, CarPos>();
      for (const car of b.cars) {
        positions.set(car.driverId, carPos(car, olderById.get(car.driverId), t, painters));
      }

      const w = weatherRef.current;
      const rainy = isRainy(w);
      const tod = todRef.current;
      const hId = heroIdRef.current;
      const marks = marksRef.current;
      const sparks = sparksRef.current;

      addTyreMarks(marks, b.cars, positions, now);
      drawTyreMarks(ctx, marks, now);

      if (rainy) drawReflections(ctx, b.cars, positions);

      drawHammerGlow(ctx, b.cars, positions);

      const emitChance = dt;
      for (const car of b.cars) {
        const pos = positions.get(car.driverId);
        if (!pos || pos.inPits) continue;
        const hot = car.hammerTime?.active === true;
        if (hot || (pos.lateral > 0.25 && Math.random() < emitChance * 5)) {
          const n = hot ? 2 : 1;
          for (let i = 0; i < n; i++) emitSpark(sparks, pos, hot ? "#ff2d55" : "#ffaa00", now);
        }
      }
      updateSparks(sparks, dt, now);
      drawSparks(ctx, sparks, now);

      drawCars(ctx, b.cars, positions, hId, rainy, tod);

      const rainDrops = ensureRain(w);
      if (rainDrops.length > 0) {
        drawRain(ctx, rainDrops, dt, w, sparks, now);
      }

      drawWeatherOverlay(ctx, w);
      drawTimeOfDayOverlay(ctx, tod);

      if (tod === "night") drawHeadlights(ctx, b.cars, positions, hId);

      drawHud(ctx, geom, b.totalLaps ? ` · ${b.totalLaps} кругов` : "");
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [geom, painters]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ width: "100%", maxWidth: W, height: "auto", borderRadius: 12, background: "#0a0a0f" }}
    />
  );
}

function addTyreMarks(marks: Map<string, { x: number; y: number; t: number }[]>, cars: SessionCar[], positions: Map<string, CarPos>, now: number): void {
  for (const car of cars) {
    const pos = positions.get(car.driverId);
    if (!pos || pos.inPits) continue;
    const hot = car.hammerTime?.active === true;
    const arr = marks.get(car.driverId) ?? [];
    arr.push({ x: pos.x, y: pos.y, t: now });
    const cap = hot ? MARK_MAX_PER_CAR + 3 : MARK_MAX_PER_CAR;
    while (arr.length > cap || (arr.length > 0 && now - arr[0]!.t > MARK_TTL_MS)) arr.shift();
    marks.set(car.driverId, arr);
  }
}

function drawTyreMarks(ctx: CanvasRenderingContext2D, marks: Map<string, { x: number; y: number; t: number }[]>, now: number): void {
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  for (const arr of marks.values()) {
    for (let i = 1; i < arr.length; i++) {
      const p0 = arr[i - 1]!;
      const p1 = arr[i]!;
      const age = now - p1.t;
      if (age > MARK_TTL_MS) continue;
      const alpha = 0.32 * (1 - age / MARK_TTL_MS);
      ctx.strokeStyle = `rgba(18,18,22,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }
}

function drawReflections(ctx: CanvasRenderingContext2D, cars: SessionCar[], positions: Map<string, CarPos>): void {
  for (const car of cars) {
    const pos = positions.get(car.driverId);
    if (!pos || pos.inPits) continue;
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.translate(pos.x, pos.y + 10);
    ctx.scale(1, -0.4);
    ctx.rotate(pos.angle);
    ctx.fillStyle = car.finished ? "#334155" : teamColor(car.team);
    roundRectPath(ctx, -CAR_LEN / 2, -CAR_W / 2, CAR_LEN, CAR_W, 3);
    ctx.fill();
    ctx.restore();
  }
}

function drawHammerGlow(ctx: CanvasRenderingContext2D, cars: SessionCar[], positions: Map<string, CarPos>): void {
  for (const car of cars) {
    if (!car.hammerTime?.active) continue;
    const pos = positions.get(car.driverId);
    if (!pos) continue;
    const r = 26;
    const grad = ctx.createRadialGradient(pos.x, pos.y, 4, pos.x, pos.y, r);
    grad.addColorStop(0, "rgba(255,45,85,0.45)");
    grad.addColorStop(1, "rgba(255,45,85,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function emitSpark(sparks: Spark[], pos: CarPos, color: string, now: number): void {
  if (sparks.length >= SPARK_MAX) sparks.shift();
  const spread = Math.random() * Math.PI * 2;
  const sp = 30 + Math.random() * 70;
  sparks.push({
    x: pos.x,
    y: pos.y,
    vx: Math.cos(spread) * sp,
    vy: Math.sin(spread) * sp - 20,
    bornAt: now,
    color,
    size: 1 + Math.random() * 1.2,
  });
}

function updateSparks(sparks: Spark[], dt: number, now: number): void {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]!;
    if (now - s.bornAt > SPARK_LIFE_MS) {
      sparks.splice(i, 1);
      continue;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 120 * dt;
  }
}

function drawSparks(ctx: CanvasRenderingContext2D, sparks: Spark[], now: number): void {
  for (const s of sparks) {
    const age = (now - s.bornAt) / SPARK_LIFE_MS;
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
  }
  ctx.globalAlpha = 1;
}

function drawCars(ctx: CanvasRenderingContext2D, cars: SessionCar[], positions: Map<string, CarPos>, heroId: string, rainy: boolean, tod: TimeOfDay | undefined): void {
  const night = tod === "night";
  for (const car of cars) {
    const pos = positions.get(car.driverId);
    if (!pos) continue;
    const isHero = car.driverId === heroId;
    const fill = car.finished ? "#334155" : teamColor(car.team);
    const ang = pos.angle;
    const off = pos.lateral > 0.05 && !pos.inPits ? pos.lateral * 14 : 0;
    const px = pos.x + -Math.sin(ang) * off;
    const py = pos.y + Math.cos(ang) * off;

    ctx.save();
    ctx.translate(px, py + 4);
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.beginPath();
    ctx.ellipse(0, 0, CAR_LEN / 2 + 2, CAR_W / 2 + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = fill;
    roundRectPath(ctx, -CAR_LEN / 2, -CAR_W / 2, CAR_LEN, CAR_W, 3);
    ctx.fill();
    if (isHero) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#fde047";
      ctx.stroke();
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(-CAR_LEN / 2 + 4, -CAR_W / 2 + 2, CAR_LEN - 8, 2);
    if (car.tyreCompound) {
      ctx.fillStyle = TYRE_COLORS[car.tyreCompound];
      ctx.beginPath();
      ctx.arc(CAR_LEN / 2 - 4, 0, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (car.drsActive && !pos.inPits) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = "rgba(0,210,106,0.85)";
      ctx.fillRect(CAR_LEN / 2 - 2, -CAR_W / 2 - 4, 3, 3);
      ctx.restore();
    }

    if (night && !pos.inPits) {
      const rx = px - Math.cos(ang) * (CAR_LEN / 2 + 1);
      const ry = py - Math.sin(ang) * (CAR_LEN / 2 + 1);
      ctx.fillStyle = "rgba(255,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (car.blueFlag) {
      ctx.fillStyle = "#3b82f6";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText("🔵", px - 5, py - 14);
    }
  }

  const hero = cars.find((c) => c.driverId === heroId);
  const heroPos = hero ? positions.get(heroId) : null;
  if (hero && heroPos && !heroPos.inPits) {
    ctx.fillStyle = "#fde047";
    ctx.font = "bold 12px system-ui, sans-serif";
    const tag = hero.position != null ? `P${hero.position} ` : "";
    ctx.fillText(`${tag}${hero.name}`, heroPos.x + 14, heroPos.y - 12);
  }
}

function drawRain(ctx: CanvasRenderingContext2D, drops: RainDrop[], dt: number, w: Weather | undefined, sparks: Spark[], now: number): void {
  const slant = Math.tan((75 * Math.PI) / 180);
  const heavy = w === "heavyRain";
  ctx.strokeStyle = heavy ? "rgba(150,170,200,0.34)" : "rgba(150,170,200,0.26)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const d of drops) {
    const dx = d.speed * dt / slant;
    d.x += dx;
    d.y += d.speed * dt;
    if (d.y > H) {
      d.y = -d.len;
      d.x = Math.random() * W;
      if (heavy && Math.random() < 0.25 && sparks.length < SPARK_MAX) {
        sparks.push({ x: d.x, y: H - 4, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 30, bornAt: now, color: "rgba(170,200,230,0.7)", size: 1.5 });
      }
    }
    if (d.x > W) d.x -= W;
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - dx * 1.6, d.y - d.len);
  }
  ctx.stroke();
}

function drawWeatherOverlay(ctx: CanvasRenderingContext2D, w: Weather | undefined): void {
  if (w === "heavyRain") {
    ctx.fillStyle = "rgba(20,30,45,0.20)";
    ctx.fillRect(0, 0, W, H);
  } else if (w === "lightRain") {
    ctx.fillStyle = "rgba(30,40,55,0.10)";
    ctx.fillRect(0, 0, W, H);
  }
}

function drawTimeOfDayOverlay(ctx: CanvasRenderingContext2D, tod: TimeOfDay | undefined): void {
  if (tod === "sunset") {
    ctx.fillStyle = "rgba(255,159,10,0.10)";
    ctx.fillRect(0, 0, W, H);
  } else if (tod === "night") {
    ctx.fillStyle = "rgba(2,4,12,0.28)";
    ctx.fillRect(0, 0, W, H);
  }
}

function drawHeadlights(ctx: CanvasRenderingContext2D, cars: SessionCar[], positions: Map<string, CarPos>, heroId: string): void {
  const hero = cars.find((c) => c.driverId === heroId);
  const pos = hero ? positions.get(heroId) : null;
  if (!hero || !pos || pos.inPits) return;
  const fx = pos.x + Math.cos(pos.angle) * 60;
  const fy = pos.y + Math.sin(pos.angle) * 60;
  const grad = ctx.createRadialGradient(fx, fy, 8, fx, fy, 120);
  grad.addColorStop(0, "rgba(255,255,200,0.18)");
  grad.addColorStop(1, "rgba(255,255,200,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(fx, fy, 120, 0, Math.PI * 2);
  ctx.fill();
}

function drawHud(ctx: CanvasRenderingContext2D, geom: Geom, suffix: string): void {
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(`${geom.track.name}${suffix}`, 12, H - 12);
}
