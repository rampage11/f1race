import { useEffect, useRef } from "react";
import {
  pathBounds,
  pathCumulative,
  pathPointAt,
  redBullRing,
} from "@f1race/race-engine";
import type { SessionSnapshot } from "./useRaceSession";
import { teamColor, TYRE_COLORS } from "./colors";

const W = 940;
const H = 620;
const PAD = 36;
const DOT_R = 9;

export function TrackCanvas({ snapshot, heroId }: { snapshot: SessionSnapshot | null; heroId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const track = redBullRing();
  const path = track.path2D;
  const cum = pathCumulative(path);
  const bounds = pathBounds(path);
  const lengthM = track.lengthM;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const offX = (W - spanX * scale) / 2 - bounds.minX * scale;
    const offY = (H - spanY * scale) / 2 - bounds.minY * scale;
    const sx = (x: number) => offX + x * scale;
    const sy = (y: number) => offY + y * scale;
    const toScreen = (frac: number) => {
      const p = pathPointAt(path, cum, frac);
      return { x: sx(p.x), y: sy(p.y), angle: p.angle };
    };

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, W, H);

    // track outline
    const drawTrace = (width: number, color: string) => {
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        const x = sx(p.x);
        const y = sy(p.y);
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

    // start/finish line
    const sf = pathPointAt(path, cum, 0);
    const sfx = sx(sf.x);
    const sfy = sy(sf.y);
    ctx.save();
    ctx.translate(sfx, sfy);
    ctx.rotate(sf.angle + Math.PI / 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(-16, -3, 32, 6);
    ctx.restore();

    // pit lane: entry just BEFORE start/finish (97% of lap), exit just AFTER (3% of next lap),
    // connected through the infield. Cars drive entry -> pit lane -> exit (no teleport).
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    const LANE = 42;
    const infieldOffset = (p: { x: number; y: number; angle: number }) => {
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

    const drawLane = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      ctx.beginPath();
      ctx.moveTo(sx(from.x), sy(from.y));
      ctx.lineTo(sx(to.x), sy(to.y));
      ctx.lineCap = "round";
      ctx.lineWidth = 12;
      ctx.strokeStyle = "#243049";
      ctx.stroke();
    };
    drawLane(pitA, pitB);
    // entry/exit arms
    drawLane(entryPt, pitA);
    drawLane(pitB, exitPt);
    // dashed centre line of the pit lane
    ctx.beginPath();
    ctx.moveTo(sx(pitA.x), sy(pitA.y));
    ctx.lineTo(sx(pitB.x), sy(pitB.y));
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "#64748b";
    ctx.stroke();
    ctx.setLineDash([]);
    // pit-box marks along the pit lane
    for (let i = 0; i < 8; i++) {
      const f = i / 7;
      const px = pitA.x + (pitB.x - pitA.x) * f + inEntry.x * 0.25;
      const py = pitA.y + (pitB.y - pitA.y) * f + inEntry.y * 0.25;
      ctx.fillStyle = "#334155";
      ctx.fillRect(sx(px) - 4, sy(py) - 4, 8, 8);
    }
    // entry/exit markers on the racing line
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(sx(entryPt.x), sy(entryPt.y), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx(exitPt.x), sy(exitPt.y), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText("PIT IN", sx(entryPt.x) + 8, sy(entryPt.y) - 6);
    ctx.fillText("PIT OUT", sx(exitPt.x) + 8, sy(exitPt.y) - 6);

    if (!snapshot) return;

    const pitDelta = track.pitLaneDelta;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

    const pitPosition = (car: { pitTimer?: number; gridPosition?: number | null }) => {
      const g = pitDelta > 0 ? clamp01(1 - (car.pitTimer ?? 0) / pitDelta) : 1;
      const shift = (((car.gridPosition ?? 1) ?? 1) % 3 - 1) * 3;
      const sxOff = inEntry.x * (shift / LANE);
      const syOff = inEntry.y * (shift / LANE);
      let fx: number;
      let fy: number;
      if (g < 0.15) {
        const t = g / 0.15;
        fx = lerp(entryPt.x, pitA.x, t);
        fy = lerp(entryPt.y, pitA.y, t);
      } else if (g < 0.85) {
        let lf = (g - 0.15) / 0.7;
        if (lf > 0.42 && lf < 0.58) lf = 0.5;
        else if (lf <= 0.42) lf = (lf / 0.42) * 0.5;
        else lf = 0.5 + ((lf - 0.58) / 0.42) * 0.5;
        fx = lerp(pitA.x, pitB.x, lf);
        fy = lerp(pitA.y, pitB.y, lf);
      } else {
        const t = (g - 0.85) / 0.15;
        fx = lerp(pitB.x, exitPt.x, t);
        fy = lerp(pitB.y, exitPt.y, t);
      }
      return { x: sx(fx + sxOff), y: sy(fy + syOff) };
    };

    for (const car of snapshot.cars) {
      let pos: { x: number; y: number; angle?: number };
      if (car.inPits) {
        const p = pitPosition(car);
        pos = { x: p.x, y: p.y };
      } else {
        const p = toScreen(car.sFraction);
        pos = { x: p.x, y: p.y, angle: p.angle };
      }
      const r = DOT_R;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = car.finished ? "#334155" : teamColor(car.team);
      ctx.fill();
      ctx.lineWidth = car.driverId === heroId ? 3 : 1;
      ctx.strokeStyle = car.driverId === heroId ? "#fde047" : "#0b1220";
      ctx.stroke();

      // lateral lane offset during an overtake maneuver
      const lat = car.lateral ?? 0;
      if (typeof pos.angle === "number" && lat > 0.05 && !car.inPits) {
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

      // tyre-colored dot core to show compound (race only)
      if (car.tyreCompound) {
        const coreX = lat > 0.05 && typeof pos.angle === "number" && !car.inPits
          ? pos.x + -Math.sin(pos.angle) * lat * 16
          : pos.x;
        const coreY = lat > 0.05 && typeof pos.angle === "number" && !car.inPits
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

    // hero label
    const hero = snapshot.cars.find((c) => c.driverId === heroId);
    if (hero && !hero.inPits) {
      const p = toScreen(hero.sFraction);
      ctx.fillStyle = "#fde047";
      ctx.font = "bold 12px system-ui, sans-serif";
      const tag = hero.position != null ? `P${hero.position} ` : "";
      ctx.fillText(`${tag}${hero.name}`, p.x + 12, p.y - 10);
    }

    // legend
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px system-ui, sans-serif";
    const lapInfo = snapshot.totalLaps ? ` · ${snapshot.totalLaps} кругов` : "";
    ctx.fillText(`${track.name}${lapInfo}`, 12, H - 12);
  }, [snapshot, heroId, path, cum, bounds, lengthM]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ width: "100%", maxWidth: W, height: "auto", borderRadius: 12, background: "#0b1220" }}
    />
  );
}
