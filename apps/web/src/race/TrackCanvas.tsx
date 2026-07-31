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

    // pit entry marker
    const pitFrac = track.pitEntryS / lengthM;
    const pit = pathPointAt(path, cum, pitFrac);
    ctx.beginPath();
    ctx.arc(sx(pit.x), sy(pit.y), 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fbbf24";
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("PIT", sx(pit.x) + 8, sy(pit.y) - 6);

    if (!snapshot) return;

    // infield center for cars sitting in the pits
    const cx = sx((bounds.minX + bounds.maxX) / 2);
    const cy = sy((bounds.minY + bounds.maxY) / 2);

    for (const car of snapshot.cars) {
      let pos: { x: number; y: number };
      if (car.inPits) {
        pos = { x: cx, y: cy };
      } else {
        const p = toScreen(car.sFraction);
        pos = { x: p.x, y: p.y };
      }
      const r = DOT_R;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = car.inPits ? "#475569" : car.finished ? "#334155" : teamColor(car.team);
      ctx.fill();
      ctx.lineWidth = car.driverId === heroId ? 3 : 1;
      ctx.strokeStyle = car.driverId === heroId ? "#fde047" : "#0b1220";
      ctx.stroke();

      // tyre-colored dot core to show compound
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = TYRE_COLORS[car.tyreCompound];
      ctx.fill();
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
