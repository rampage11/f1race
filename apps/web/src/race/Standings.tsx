import { useEffect, useMemo, useState } from "react";
import { pathBounds, pathCumulative, pathPointAt, trackById } from "@f1race/race-engine";
import type { SessionSnapshot } from "./useRaceSession";
import { formatGap, teamColor, TYRE_COLORS, TYRE_LABEL } from "./colors";

const MM_W = 96;
const MM_H = 76;

export interface HeroFlash {
  id: number;
  kind: "gain" | "loss";
}

function StandingsMinimap({ snapshot, heroId }: { snapshot: SessionSnapshot; heroId: string }) {
  const polylines = useMemo(() => {
    const track = (snapshot.trackId ? trackById(snapshot.trackId) : undefined);
    if (!track) return null;
    const cum = pathCumulative(track.path2D);
    const b = pathBounds(track.path2D);
    const spanX = b.maxX - b.minX || 1;
    const spanY = b.maxY - b.minY || 1;
    const scale = Math.min((MM_W - 8) / spanX, (MM_H - 8) / spanY);
    const offX = (MM_W - spanX * scale) / 2 - b.minX * scale;
    const offY = (MM_H - spanY * scale) / 2 - b.minY * scale;
    const trackPts: string[] = track.path2D.map((p) => {
      const x = offX + p.x * scale;
      const y = offY + p.y * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).concat([`${(offX + track.path2D[0]!.x * scale).toFixed(1)},${(offY + track.path2D[0]!.y * scale).toFixed(1)}`]);
    const carDots = snapshot.cars.map((c) => {
      const frac = c.finished ? c.sFraction : c.sFraction;
      const p = pathPointAt(track.path2D, cum, frac);
      const x = offX + p.x * scale;
      const y = offY + p.y * scale;
      const isHero = c.driverId === heroId;
      const pos = c.position ?? 99;
      const color = isHero ? "#00d26a" : pos <= 3 ? "#ffd60a" : pos <= 10 ? "#ffffff" : "rgba(255,255,255,0.4)";
      return { x, y, color, isHero };
    });
    return { trackPts, carDots };
  }, [snapshot.trackId, snapshot.cars, heroId]);

  if (!polylines) return null;
  return (
    <svg className="ds-minimap" viewBox={`0 0 ${MM_W} ${MM_H}`} width={MM_W} height={MM_H} aria-hidden="true">
      <polyline points={polylines.trackPts.join(" ")} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {polylines.carDots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.isHero ? 3 : 2} fill={d.color} className={d.isHero ? "ds-mm-hero" : ""} />
      ))}
    </svg>
  );
}

function posColor(pos: number | null): string {
  if (pos == null) return "var(--text-tertiary)";
  if (pos <= 3) return "var(--accent-gold)";
  if (pos <= 10) return "var(--text-primary)";
  return "var(--text-tertiary)";
}

export function Standings({ snapshot, heroId, heroFlash }: { snapshot: SessionSnapshot; heroId: string; heroFlash?: HeroFlash | null }) {
  const ranked = useMemo(() => [...snapshot.cars].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)), [snapshot.cars]);
  const lapTime = ranked.find((c) => c.position === 1)?.bestLapTime
    ?? ranked.find((c) => c.lastLapTime != null)?.lastLapTime
    ?? undefined;

  const [flashClass, setFlashClass] = useState<string>("");
  useEffect(() => {
    if (!heroFlash) return;
    setFlashClass(heroFlash.kind === "gain" ? "flash-gain" : "flash-loss");
    const t = setTimeout(() => setFlashClass(""), 800);
    return () => clearTimeout(t);
  }, [heroFlash]);

  return (
    <section className="glass-panel ds-standings">
      <div className="ds-stand-head">
        <h3 className="ds-heading">Позиции</h3>
        <StandingsMinimap snapshot={snapshot} heroId={heroId} />
      </div>
      <div className="ds-stand-list">
        {ranked.map((c) => {
          const isHero = c.driverId === heroId;
          const heroCls = isHero ? `hero ${flashClass}`.trim() : "";
          return (
            <div key={c.driverId} className={`ds-stand-row ${heroCls} ${c.inPits ? "pitting" : ""}`}>
              <span className="ds-stand-pos ds-mono" style={{ color: posColor(c.position) }}>{c.finished ? "🏁" : c.position ?? "·"}</span>
              <span className="ds-stand-dot" style={{ background: teamColor(c.team) }} />
              <span className="ds-stand-name">{c.name}</span>
              <span className="ds-stand-tyre" style={{ color: c.tyreCompound ? TYRE_COLORS[c.tyreCompound] : "var(--text-tertiary)" }}>
                {c.tyreCompound ? TYRE_LABEL[c.tyreCompound][0] : "·"}
              </span>
              <span className="ds-stand-gap ds-mono">{isHero ? "" : formatGap(c.gapAhead ?? 0, lapTime)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
