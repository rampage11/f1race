import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { pathPointAt } from "../../../packages/race-engine/src/index.js";
import type { PathPoint, Point2D } from "../../../packages/race-engine/src/index.js";
import lapData from "../src/data/lap.json";

interface SpeedSample {
  dM: number;
  kmh: number;
}

const LAP = lapData as {
  trackName: string;
  lengthM: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  path: Point2D[];
  cum: number[];
  speed: SpeedSample[];
  speedMin: number;
  speedMax: number;
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../public/og.png");

const W = 1200;
const H = 630;
const BG = "#0c0f13";

const C_FAST = "#0EA5E9";
const C_MID = "#F97316";
const C_SLOW = "#C2410C";
const C_OUTER = "#1f2937";
const C_INNER = "#334155";

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

function colorForSpeed(kmh: number): string {
  const span = LAP.speedMax - LAP.speedMin || 1;
  const t = Math.max(0, Math.min(1, (kmh - LAP.speedMin) / span));
  if (t >= 0.5) return lerpHex(C_FAST, C_MID, (1 - t) / 0.5);
  return lerpHex(C_MID, C_SLOW, (0.5 - t) / 0.5);
}

function speedAt(frac: number): number {
  const f = ((frac % 1) + 1) % 1;
  const sp = LAP.speed;
  const idx = f * sp.length;
  const i0 = Math.floor(idx) % sp.length;
  const i1 = (i0 + 1) % sp.length;
  const t = idx - Math.floor(idx);
  const a = sp[i0];
  const b = sp[i1];
  if (!a || !b) return LAP.speedMin;
  return a.kmh + (b.kmh - a.kmh) * t;
}

const b = LAP.bounds;
const tw = b.maxX - b.minX;
const th = b.maxY - b.minY;
const boxX0 = 90;
const boxX1 = 1110;
const boxY0 = 210;
const boxY1 = 470;
const boxW = boxX1 - boxX0;
const boxH = boxY1 - boxY0;
const scale = Math.min(boxW / tw, boxH / th);
const drawW = tw * scale;
const drawH = th * scale;
const offX = boxX0 + (boxW - drawW) / 2 - b.minX * scale;
const offY = boxY0 + (boxH - drawH) / 2 - b.minY * scale;
const tx = (x: number) => offX + x * scale;
const ty = (y: number) => offY + y * scale;

const M = 500;
const pts: PathPoint[] = [];
for (let i = 0; i < M; i++) pts.push(pathPointAt(LAP.path, LAP.cum, i / M));
const closed: PathPoint[] = [...pts, pts[0]];

const polyPts = closed.map((p) => `${tx(p.x).toFixed(2)},${ty(p.y).toFixed(2)}`).join(" ");

let apexIdx = 0;
for (let i = 1; i < LAP.speed.length; i++) {
  if (LAP.speed[i].kmh < LAP.speed[apexIdx].kmh) apexIdx = i;
}
const apexFrac = apexIdx / LAP.speed.length;
const WIN = 0.14;
const winStart = apexFrac - WIN;

function inWin(frac: number): boolean {
  const f = ((frac % 1) + 1) % 1;
  const a = ((apexFrac % 1) + 1) % 1;
  const s = ((winStart % 1) + 1) % 1;
  return s <= a ? f >= s && f <= a : f >= s || f <= a;
}

const OUTER_W = 20;
const INNER_W = 7.5;
const COLOR_W = 9.5;

const coloredSegs: string[] = [];
for (let i = 0; i < M; i++) {
  const f0 = i / M;
  const f1 = (i + 1) / M;
  const mid = f0 + (1 / M) * 0.5;
  if (!inWin(mid)) continue;
  const p0 = pts[i];
  const p1 = i === M - 1 ? pts[0] : pts[i + 1];
  if (!p0 || !p1) continue;
  const col = colorForSpeed(speedAt(mid));
  coloredSegs.push(
    `<line x1="${tx(p0.x).toFixed(2)}" y1="${ty(p0.y).toFixed(2)}" x2="${tx(p1.x).toFixed(2)}" y2="${ty(p1.y).toFixed(2)}" stroke="${col}" stroke-width="${COLOR_W}" stroke-linecap="round"/>`,
  );
}

const apex = pts[Math.round(apexFrac * (M - 1))] ?? pts[0];
const ax = tx(apex.x);
const ay = ty(apex.y);
const startP = pts[0];
const sx = startP ? tx(startP.x) : 0;
const sy = startP ? ty(startP.y) : 0;

const trackLabel = `${LAP.trackName.toUpperCase()} · ${(LAP.lengthM / 1000).toFixed(1)} KM`;
const apexKmh = `${Math.round(LAP.speedMin)}`;

const parts: string[] = [];
parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
parts.push(`<defs>
  <radialGradient id="bgGlow" cx="20%" cy="0%" r="80%">
    <stop offset="0%" stop-color="#1a2230" stop-opacity="0.95"/>
    <stop offset="55%" stop-color="#0c0f13" stop-opacity="0"/>
  </radialGradient>
</defs>`);
parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);
parts.push(`<rect width="${W}" height="${H}" fill="url(#bgGlow)"/>`);

parts.push(
  `<polyline points="${polyPts}" fill="none" stroke="${C_OUTER}" stroke-width="${OUTER_W}" stroke-linejoin="round" stroke-linecap="round"/>`,
);
parts.push(
  `<polyline points="${polyPts}" fill="none" stroke="${C_INNER}" stroke-width="${INNER_W}" stroke-linejoin="round" stroke-linecap="round"/>`,
);
parts.push(coloredSegs.join("\n"));

parts.push(
  `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="5" fill="#f8fafc" opacity="0.9"/>`,
);
parts.push(`<circle cx="${ax.toFixed(2)}" cy="${ay.toFixed(2)}" r="36" fill="${C_MID}" opacity="0.12"/>`);
parts.push(`<circle cx="${ax.toFixed(2)}" cy="${ay.toFixed(2)}" r="21" fill="${C_MID}" opacity="0.22"/>`);
parts.push(`<circle cx="${ax.toFixed(2)}" cy="${ay.toFixed(2)}" r="10.5" fill="${C_MID}"/>`);
parts.push(`<circle cx="${ax.toFixed(2)}" cy="${ay.toFixed(2)}" r="3.5" fill="#fff7ed"/>`);

const labelX = ax + 20;
const labelY = ay - 12;
parts.push(
  `<line x1="${(ax + 9).toFixed(2)}" y1="${ay.toFixed(2)}" x2="${(labelX - 4).toFixed(2)}" y2="${(labelY + 4).toFixed(2)}" stroke="${C_MID}" stroke-width="1.4" opacity="0.6"/>`,
);
parts.push(
  `<text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="20" font-weight="600" fill="${C_MID}">${apexKmh} км/ч</text>`,
);

parts.push(
  `<text x="80" y="128" font-family="'Space Grotesk', 'Inter', system-ui, sans-serif" font-size="82" font-weight="700" letter-spacing="-2.5" fill="#f8fafc">F1race</text>`,
);
parts.push(
  `<text x="84" y="170" font-family="'Inter', system-ui, sans-serif" font-size="27" font-weight="500" fill="#9aa3b4">Гонка, которую считает сервер</text>`,
);
parts.push(
  `<text x="1120" y="92" text-anchor="end" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="17" font-weight="600" letter-spacing="2.5" fill="#6b7484">${trackLabel}</text>`,
);

parts.push(`<rect x="80" y="576" width="12" height="12" rx="2" fill="${C_FAST}"/>`);
parts.push(`<rect x="98" y="576" width="12" height="12" rx="2" fill="${C_SLOW}"/>`);
parts.push(
  `<text x="118" y="586" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="15" font-weight="500" fill="#838c99">газ → торможение</text>`,
);

parts.push(`</svg>`);

const svg = parts.join("\n");

await mkdir(dirname(outPath), { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(outPath, png);

console.log(`rendered OG → ${outPath} (${W}×${H}, ${png.length} bytes)`);
console.log(`apex (braking) at frac ${apexFrac.toFixed(3)}, speed ${Math.round(LAP.speedMin)} км/ч`);
