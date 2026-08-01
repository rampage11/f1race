import type { PilotProfile, TyreCompound } from "@f1race/race-engine";
import { formatRaceTime } from "./colors";
import { PitPanel } from "./PitPanel";
import { QualyBoard } from "./QualyBoard";
import { Standings } from "./Standings";
import { Telemetry } from "./Telemetry";
import { TrackCanvas } from "./TrackCanvas";
import { useRaceSession } from "./useRaceSession";

const SPEEDS = [2, 6, 12, 24];

function teamColorOf(team: string): string {
  const map: Record<string, string> = {
    "Red Bull": "#1E3A8A", Ferrari: "#DC2626", Mercedes: "#00A19B", McLaren: "#F97316",
    "Aston Martin": "#15803D", Alpine: "#7C3AED", Williams: "#0EA5E9", AlphaTauri: "#475569",
    Sauber: "#16A34A", Haas: "#E5E7EB", Academy: "#FBBF24",
  };
  return map[team] ?? "#9CA3AF";
}

export function RaceView({ hero, onChangeDriver }: { hero: PilotProfile; onChangeDriver: () => void }) {
  const s = useRaceSession(hero);
  const snap = s.snapshot;
  const heroCar = snap?.cars.find((c) => c.driverId === s.heroId) ?? null;
  const isQualy = s.stage === "qualy";
  const isRace = s.stage === "race";
  const stageLabel = isQualy ? "Квалификация" : isRace ? "Гонка" : "Финиш";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {hero.name} <span className="team-dot-inline" style={{ background: teamColorOf(hero.team) }} /> · {hero.team}
          <span className="stage-badge">{stageLabel}</span>
          {!s.connected && <span className="warn-text"> · нет связи с сервером</span>}
        </div>
        <div className="controls">
          <button className="play" onClick={() => s.setPaused(!s.paused)}>
            {s.paused ? "▶ Играть" : "❚❚ Пауза"}
          </button>
          <div className="speeds">
            {SPEEDS.map((sp) => (
              <button key={sp} className={sp === s.speed ? "active" : ""} onClick={() => s.setSpeed(sp)}>
                {sp}×
              </button>
            ))}
          </div>
          <button className="restart" onClick={s.restart}>↻ Заново</button>
          <button className="ghost" onClick={onChangeDriver}>Сменить пилота</button>
        </div>
      </header>

      <main className="layout">
        <div className="stage">
          <TrackCanvas snapshot={snap} heroId={s.heroId} />
          {s.stage === "finished" && s.result && (
            <div className="overlay">
              <div className="card">
                <h2>Гонка завершена</h2>
                <ResultSummary result={s.result} heroId={s.heroId} />
                <div className="overlay-actions">
                  <button onClick={s.restart}>↻ Гонять снова</button>
                  <button className="ghost" onClick={onChangeDriver}>Сменить пилота</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="side">
          {snap && heroCar && isQualy && <QualyBoard snapshot={snap} heroId={s.heroId} />}
          {snap && heroCar && isRace && (
            <>
              <Telemetry snapshot={snap} hero={heroCar} grid={heroCar.gridPosition ?? heroCar.position ?? 0} />
              <PitPanel snapshot={snap} hero={heroCar} onPit={(c: TyreCompound) => s.requestPit(c)} onCancel={() => {}} />
              <Standings snapshot={snap} heroId={s.heroId} />
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

function ResultRow({ r, heroId }: { r: { driverId: string; place: number; gridPosition: number; raceTime: number; tyreStops: number; bestLapTime: number | null; fastestLap: boolean }; heroId: string }) {
  return (
    <tr className={r.driverId === heroId ? "hero" : ""}>
      <td>{r.place}</td>
      <td>{r.gridPosition}</td>
      <td>{formatRaceTime(r.raceTime)}</td>
      <td>{r.tyreStops} пит</td>
      <td>{r.bestLapTime ? `${r.bestLapTime.toFixed(2)}${r.fastestLap ? " ⚡" : ""}` : "—"}</td>
    </tr>
  );
}

function ResultSummary({ result, heroId }: { result: import("@f1race/race-engine").RaceResult; heroId: string }) {
  const heroRow = result.rows.find((r) => r.driverId === heroId);
  const top = result.rows.slice(0, 10);
  const heroInTop = top.some((r) => r.driverId === heroId);
  const heroExtra = !heroInTop && heroRow ? heroRow : null;
  return (
    <div className="result">
      <p className="result-headline">
        Финиш <strong>P{heroRow?.place}</strong> из {result.rows.length} · старт P{heroRow?.gridPosition}
        {heroRow && heroRow.positionsGained > 0 ? ` · +${heroRow.positionsGained}` : ""}
        {heroRow?.fastestLap ? " · быстрейший круг ⚡" : ""}
      </p>
      <table>
        <thead>
          <tr><th>М</th><th>Старт</th><th>Время</th><th>Питы</th><th>Лучший круг</th></tr>
        </thead>
        <tbody>
          {top.map((r) => <ResultRow key={r.driverId} r={r} heroId={heroId} />)}
          {heroExtra && (
            <>
              <tr className="ellipsis"><td colSpan={5}>…</td></tr>
              <ResultRow r={heroExtra} heroId={heroId} />
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
