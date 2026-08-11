import type { SessionCar, SessionSnapshot } from "./useRaceSession";
import { formatGap, formatRaceTime, msToKmh, TYRE_COLORS, TYRE_LABEL } from "./colors";

const SPEED_MAX = 340;

function tyreWearColor(wear: number): string {
  if (wear >= 0.85) return "var(--accent-red)";
  if (wear >= 0.6) return "var(--accent-orange)";
  return "var(--accent-green)";
}

export function Telemetry({ snapshot, hero, grid }: { snapshot: SessionSnapshot; hero: SessionCar; grid: number }) {
  const kmh = msToKmh(hero.v);
  const speedPct = Math.max(0, Math.min(100, (kmh / SPEED_MAX) * 100));
  const tyre = hero.tyreCompound ?? null;
  const lap = hero.lap ?? 0;
  const totalLaps = snapshot.totalLaps ?? 0;
  const pos = hero.position ?? 0;
  const gapAhead = hero.gapAhead ?? 0;
  const gapClass = gapAhead > 3 ? "gap-warn" : gapAhead < 1 ? "gap-good" : "";
  const isFastest = snapshot.cars.length > 0
    && hero.bestLapTime != null
    && snapshot.cars.every((c) => c.bestLapTime == null || c.bestLapTime >= hero.bestLapTime!);
  const gapToLeader = pos > 1
    ? snapshot.cars.reduce(
        (sum, c) => {
          const p = c.position ?? 0;
          return p > 1 && p <= pos ? sum + (c.gapAhead ?? 0) : sum;
        },
        0,
      )
    : 0;
  const lapTime = hero.lastLapTime ?? hero.bestLapTime ?? undefined;

  return (
    <div className="ds-telemetry">
      <div className="glass-panel ds-tel-left">
        <div className="ds-microtext">Позиция · старт P{grid}</div>
        <div className="ds-tel-pos ds-mono">
          P{pos}<span className="ds-tel-of">/{snapshot.cars.length}</span>
        </div>
        <div className="ds-tel-gaps">
          <div className={`ds-tel-gap ${gapClass}`}>
            <span className="ds-microtext">отрыв</span>
            <span className="ds-mono">{formatGap(gapAhead, lapTime)}</span>
          </div>
          <div className="ds-tel-gap">
            <span className="ds-microtext">лидер</span>
            <span className="ds-mono">{pos > 1 ? formatGap(gapToLeader, lapTime) : "—"}</span>
          </div>
        </div>
        <div className="ds-tel-lap ds-mono">LAP {Math.min(lap + 1, totalLaps || lap + 1)}/{totalLaps}</div>
        <div className="ds-tel-gaps">
          <div className="ds-tel-best">
            <span className="ds-microtext">посл. круг</span>
            <span className="ds-mono">{hero.lastLapTime != null ? `${hero.lastLapTime.toFixed(2)}с` : "—"}</span>
          </div>
          <div className={`ds-tel-best ${isFastest ? "fastest" : ""}`}>
            <span className="ds-microtext">лучш.</span>
            <span className="ds-mono">{hero.bestLapTime != null ? `${hero.bestLapTime.toFixed(2)}с` : "—"}</span>
          </div>
        </div>
      </div>

      <div className="glass-panel ds-tel-right">
        <div className="ds-tel-speed">
          <span className="ds-tel-kmh ds-mono">{Math.round(kmh)}</span>
          <span className="ds-microtext">км/ч</span>
        </div>
        <div className="ds-bar">
          <div className="ds-bar-fill ds-rpm" style={{ width: `${speedPct}%` }} />
        </div>

        <div className="ds-tyre-block">
          {tyre ? (
            <>
              <div className="ds-tyre-head">
                <span className="ds-tyre-dot" style={{ background: TYRE_COLORS[tyre] }} />
                <span className="ds-tyre-name">{TYRE_LABEL[tyre]}</span>
                <span className="ds-tyre-pct ds-mono">{Math.round((hero.tyreWear ?? 0) * 100)}%</span>
              </div>
              <div className="ds-bar">
                <div className="ds-bar-fill" style={{ width: `${Math.round((hero.tyreWear ?? 0) * 100)}%`, background: tyreWearColor(hero.tyreWear ?? 0) }} />
              </div>
              <div className="ds-tyre-temps">
                <span className="ds-microtext">FL</span>
                <span className="ds-tyre-temp" />
                <span className="ds-microtext">FR</span>
                <span className="ds-tyre-temp" />
                <span className="ds-microtext">RL</span>
                <span className="ds-tyre-temp" />
                <span className="ds-microtext">RR</span>
                <span className="ds-tyre-temp" />
              </div>
            </>
          ) : (
            <span className="ds-microtext">резина —</span>
          )}
        </div>
        <div className="ds-tel-clock">
          <span className="ds-microtext">час гонки</span>
          <span className="ds-mono">{formatRaceTime(snapshot.time)}</span>
        </div>
      </div>
    </div>
  );
}
