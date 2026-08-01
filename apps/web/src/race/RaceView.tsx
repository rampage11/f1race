import { formatRaceTime } from "./colors";
import { PitPanel } from "./PitPanel";
import { Standings } from "./Standings";
import { Telemetry } from "./Telemetry";
import { TrackCanvas } from "./TrackCanvas";
import { useRaceEngine, type HeroConfig } from "./useRaceEngine";

const SPEEDS = [1, 4, 8, 20];

export function RaceView({ hero, onChangeDriver }: { hero: HeroConfig; onChangeDriver: () => void }) {
  const race = useRaceEngine(hero, 8);
  const snap = race.snapshot;
  const heroCar = snap?.cars.find((c) => c.driverId === race.heroId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {hero.name} <span className="team-dot-inline" style={{ background: teamColorOf(hero.team) }} /> · {hero.team}
        </div>
        <div className="controls">
          <button className="play" onClick={() => race.setPlaying(!race.playing)}>
            {race.playing ? "❚❚ Пауза" : "▶ Играть"}
          </button>
          <div className="speeds">
            {SPEEDS.map((s) => (
              <button key={s} className={s === race.speed ? "active" : ""} onClick={() => race.setSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
          <button className="restart" onClick={race.restart}>↻ Заново</button>
          <button className="ghost" onClick={onChangeDriver}>Сменить пилота</button>
        </div>
      </header>

      <main className="layout">
        <div className="stage">
          <TrackCanvas snapshot={snap} heroId={race.heroId} />
          {race.result && (
            <div className="overlay">
              <div className="card">
                <h2>Гонка завершена</h2>
                <ResultSummary race={race} />
                <div className="overlay-actions">
                  <button onClick={race.restart}>↻ Гонять снова</button>
                  <button className="ghost" onClick={onChangeDriver}>Сменить пилота</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="side">
          {snap && heroCar && (
            <>
              <Telemetry snapshot={snap} hero={heroCar} grid={heroCar.gridPosition} />
              <PitPanel snapshot={snap} hero={heroCar} onPit={race.requestPit} onCancel={race.cancelPit} />
              <Standings snapshot={snap} heroId={race.heroId} />
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

function ResultSummary({ race }: { race: ReturnType<typeof useRaceEngine> }) {
  if (!race.result) return null;
  const heroRow = race.result.rows.find((r) => r.driverId === race.heroId);
  const top = race.result.rows.slice(0, 10);
  const heroInTop = top.some((r) => r.driverId === race.heroId);
  const heroExtra = !heroInTop && heroRow ? heroRow : null;
  return (
    <div className="result">
      <p className="result-headline">
        Финиш <strong>P{heroRow?.place}</strong> из {race.result.rows.length} · старт P{heroRow?.gridPosition}
        {heroRow && heroRow.positionsGained > 0 ? ` · +${heroRow.positionsGained}` : ""}
        {heroRow?.fastestLap ? " · быстрейший круг ⚡" : ""}
      </p>
      <table>
        <thead>
          <tr><th>М</th><th>Старт</th><th>Время</th><th>Питы</th><th>Лучший круг</th></tr>
        </thead>
        <tbody>
          {top.map((r) => <ResultRow key={r.driverId} r={r} heroId={race.heroId} />)}
          {heroExtra && (
            <>
              <tr className="ellipsis"><td colSpan={5}>…</td></tr>
              <ResultRow r={heroExtra} heroId={race.heroId} />
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function teamColorOf(team: string): string {
  const map: Record<string, string> = {
    "Red Bull": "#1E3A8A", Ferrari: "#DC2626", Mercedes: "#00A19B", McLaren: "#F97316",
    "Aston Martin": "#15803D", Alpine: "#7C3AED", Williams: "#0EA5E9", AlphaTauri: "#475569",
    Sauber: "#16A34A", Haas: "#E5E7EB", Academy: "#FBBF24",
  };
  return map[team] ?? "#9CA3AF";
}
