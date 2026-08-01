import { useEffect, useRef } from "react";
import {
  pathBounds,
  pathCumulative,
  pathPointAt,
  redBullRing,
  type RaceSnapshot,
} from "@f1race/race-engine";
import { teamColor, TYRE_COLORS } from "./colors";

const W = 940;
const H = 620;
const PAD = 36;
const DOT_R = 9;

export function TrackCanvas({ snapshot, heroId }: { snapshot: RaceSnapshot | null; heroId: string }) {
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

    // pit lane: parallel to the main straight (path[0] -> path[1]), offset toward the infield
    const a = path[0]!;
    const b = path[1]!;
    const sdx = b.x - a.x;
    const sdy = b.y - a.y;
    const slen = Math.max(1e-6, Math.hypot(sdx, sdy));
    let pnx = -sdy / slen;
    let pny = sdx / slen;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const cenX = (bounds.minX + bounds.maxX) / 2;
    const cenY = (bounds.minY + bounds.maxY) / 2;
    if (pnx * (cenX - midX) + pny * (cenY - midY) < 0) {
      pnx = -pnx;
      pny = -pny;
    }
    const LANE = 40;
    const T0 = 0.18;
    const T1 = 0.82;
    const pitA = { x: a.x + sdx * T0 + pnx * LANE, y: a.y + sdy * T0 + pny * LANE };
    const pitB = { x: a.x + sdx * T1 + pnx * LANE, y: a.y + sdy * T1 + pny * LANE };
    ctx.beginPath();
    ctx.moveTo(sx(pitA.x), sy(pitA.y));
    ctx.lineTo(sx(pitB.x), sy(pitB.y));
    ctx.lineCap = "round";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#243049";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx(pitA.x), sy(pitA.y));
    ctx.lineTo(sx(pitB.x), sy(pitB.y));
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "#64748b";
    ctx.stroke();
    ctx.setLineDash([]);
    // pit boxes marks
    for (let i = 0; i < 8; i++) {
      const f = i / 7;
      const px = pitA.x + (pitB.x - pitA.x) * f + pnx * 10;
      const py = pitA.y + (pitB.y - pitA.y) * f + pny * 10;
      ctx.fillStyle = "#334155";
      ctx.fillRect(sx(px) - 4, sy(py) - 4, 8, 8);
    }
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText("PIT LANE", sx(pitA.x) - 6, sy(pitA.y) - 10);

    if (!snapshot) return;

    const pitDelta = track.pitLaneDelta;

    for (const car of snapshot.cars) {
      let pos: { x: number; y: number; angle?: number };
      if (car.inPits) {
        const g = pitDelta > 0 ? Math.max(0, Math.min(1, 1 - car.pitTimer / pitDelta)) : 1;
        const laneShift = ((car.gridPosition % 3) - 1) * 5;
        const px = pitA.x + (pitB.x - pitA.x) * g + pnx * laneShift;
        const py = pitA.y + (pitB.y - pitA.y) * g + pny * laneShift;
        pos = { x: sx(px), y: sy(py) };
      } else {
        const p = toScreen(car.sFraction);
        pos = { x: p.x, y: p.y, angle: p.angle };
      }
      const r = DOT_R;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = car.inPits ? "#475569" : car.finished ? "#334155" : teamColor(car.team);
      ctx.fill();
      ctx.lineWidth = car.driverId === heroId ? 3 : 1;
      ctx.strokeStyle = car.driverId === heroId ? "#fde047" : "#0b1220";
      ctx.stroke();

      // lateral lane offset during an overtake maneuver
      if (typeof pos.angle === "number" && car.lateral > 0.05 && !car.inPits) {
        const off = car.lateral * 16;
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

      // tyre-colored dot core to show compound
      const coreX = car.lateral > 0.05 && typeof pos.angle === "number" && !car.inPits
        ? pos.x + -Math.sin(pos.angle) * car.lateral * 16
        : pos.x;
      const coreY = car.lateral > 0.05 && typeof pos.angle === "number" && !car.inPits
        ? pos.y + Math.cos(pos.angle) * car.lateral * 16
        : pos.y;
      ctx.beginPath();
      ctx.arc(coreX, coreY, 3, 0, Math.PI * 2);
      ctx.fillStyle = TYRE_COLORS[car.tyreCompound];
      ctx.fill();

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
      ctx.fillText(`P${hero.position} ${hero.name}`, p.x + 12, p.y - 10);
    }

    // legend
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(`${track.name} · ${snapshot.totalLaps} кругов`, 12, H - 12);
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
