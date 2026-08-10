import { useEffect, useRef, useState } from "react";
import type { PilotProfile, TyreCompound, TimeOfDay, Weather } from "@f1race/race-engine";
import { formatRaceTime } from "./colors";
import { HammerButton } from "./HammerButton";
import { PitPanel } from "./PitPanel";
import { QualyBoard } from "./QualyBoard";
import { Standings } from "./Standings";
import { StartLights } from "./StartLights";
import { Telemetry } from "./Telemetry";
import { TrackCanvas } from "./TrackCanvas";
import { LobbyScreen } from "./LobbyScreen";
import { TyreSelectScreen } from "./TyreSelectScreen";
import { useRaceSession } from "./useRaceSession";
import type { RaceProgression } from "./useRaceSession";

function teamColorOf(team: string): string {
  const map: Record<string, string> = {
    "Red Bull": "#1E3A8A", Ferrari: "#DC2626", Mercedes: "#00A19B", McLaren: "#F97316",
    "Aston Martin": "#15803D", Alpine: "#7C3AED", Williams: "#0EA5E9", AlphaTauri: "#475569",
    Sauber: "#16A34A", Haas: "#E5E7EB", Academy: "#FBBF24",
  };
  return map[team] ?? "#9CA3AF";
}

const COUNTRY_FLAGS: Record<string, string> = {
  AT: "🇦🇹", IT: "🇮🇹", MC: "🇲🇨", BR: "🇧🇷",
};

const WEATHER_ICON: Record<Weather, string> = {
  dry: "☀️", lightRain: "🌦️", heavyRain: "⛈️", variable: "🌤️",
};

const TOD_ICON: Record<TimeOfDay, string> = { day: "☀️", sunset: "🌇", night: "🌙" };

const WEATHER_LABEL: Record<Weather, string> = {
  dry: "Сухо", lightRain: "Малый дождь", heavyRain: "Ливень", variable: "Перемен.",
};

export function RaceView({ hero, guestId, onChangeDriver, tutorial }: { hero: PilotProfile; guestId: string; onChangeDriver: () => void; tutorial?: boolean }) {
  const s = useRaceSession(hero, guestId, tutorial ? "tutorial" : "race");
  const snap = s.snapshot;
  const heroCar = snap?.cars.find((c) => c.driverId === s.heroId) ?? null;
  const isQualy = s.stage === "qualy";
  const isRace = s.stage === "race";
  const isStartSequence = s.stage === "startSequence";

  const [tyreSelectShown, setTyreSelectShown] = useState(false);
  const [dismissedTutStep, setDismissedTutStep] = useState<string | null>(null);
  const tyreSelectSeenForRef = useRef<string | null>(null);
  // Detect the lobby→qualy transition DURING render (not in a useEffect) so the tyre-select
  // overlay covers the canvas on the FIRST painted qualy frame — a useEffect runs only after
  // paint, which let the bare track flash for one frame (ugly on mobile). Calling setState
  // during render is the documented React pattern; it re-renders synchronously without
  // committing the intermediate frame, and the guard (seenForRef) prevents any loop.
  //
  // The driverId check is load-bearing: on the very first render (before the socket opens)
  // stage defaults to "qualy" and inLobby is false, so without it the condition would fire and
  // flash the tyre-select BEFORE the lobby search even starts. driverId is set only once the
  // server sends `welcome` (i.e. a room was actually matched), which is the real trigger.
  if (!s.inLobby && isQualy && s.driverId && tyreSelectSeenForRef.current !== s.driverId) {
    tyreSelectSeenForRef.current = s.driverId;
    setTyreSelectShown(true);
  }
  useEffect(() => {
    if (s.inLobby) {
      tyreSelectSeenForRef.current = null;
      if (tyreSelectShown) setTyreSelectShown(false);
    } else if (!isQualy && !isStartSequence && tyreSelectShown) {
      setTyreSelectShown(false);
    }
  }, [s.inLobby, isQualy, isStartSequence, tyreSelectShown]);

  const trackId = snap?.trackId ?? s.forecast?.trackId;
  const effWeather = snap?.effectiveWeather ?? s.forecast?.weather;
  const timeOfDay = snap?.timeOfDay ?? s.forecast?.timeOfDay;
  const stageLabel = isQualy
    ? "Квалификация"
    : isStartSequence
      ? "Старт"
      : isRace
        ? "Гонка"
        : "Финиш";
  const mpLocked = s.mode === "multiplayer";
  const mpLockTitle = "недоступно в мультиплеере";
  const connectedHumans = s.players.filter((p) => p.connected).length;
  const lastError = s.errors.length > 0 ? s.errors[s.errors.length - 1] : null;
  const trackName = snap?.trackName ?? s.forecast?.trackName;
  const trackCountry = snap?.trackCountry ?? s.forecast?.trackCountry;
  const lapsRemain = snap && heroCar && snap.totalLaps
    ? Math.max(0, snap.totalLaps - (heroCar.lap ?? 0))
    : s.forecast?.laps;

  if (s.inLobby) {
    return <LobbyScreen hero={hero} lobby={s.lobby} connectionState={s.connectionState} forecast={s.forecast} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {hero.name} <span className="team-dot-inline" style={{ background: teamColorOf(hero.team) }} /> · {hero.team}
          <span className="stage-badge">{stageLabel}</span>
          <span className={`mode-badge ${s.mode}`}>{s.mode === "multiplayer" ? "Мультиплеер" : "Соло"}</span>
          {s.profile ? (
            <span className="level-badge">{s.profile.division} · Ур. {s.profile.level}</span>
          ) : (
            <span className="level-badge guest">гость</span>
          )}
          {connectedHumans > 0 && <span className="players-badge">{connectedHumans} игр.</span>}
          {s.connectionState === "reconnecting" && <span className="warn-text">· переподключение…</span>}
          {s.connectionState === "disconnected" && <span className="warn-text">· связь потеряна</span>}
        </div>
        <div className="topbar-meta">
          {trackName && (
            <span className="ds-topbar-chip">
              <span className="ds-topbar-flag">{COUNTRY_FLAGS[trackCountry ?? ""] ?? "🏁"}</span>
              <span className="ds-heading">{trackName}</span>
            </span>
          )}
          {effWeather && (
            <span className="ds-topbar-chip">
              <span>{WEATHER_ICON[effWeather]}</span>
              <span>{WEATHER_LABEL[effWeather]}</span>
              {timeOfDay && <span className="ds-topbar-sub">{TOD_ICON[timeOfDay]}</span>}
            </span>
          )}
          {lapsRemain != null && (
            <span className="ds-topbar-chip">
              <span className="ds-microtext">ост. кругов</span>
              <span className="ds-mono">{lapsRemain}</span>
            </span>
          )}
          {snap && (
            <span className="ds-topbar-chip">
              <span className="ds-microtext">время</span>
              <span className="ds-mono">{formatRaceTime(snap.time)}</span>
            </span>
          )}
        </div>
        <div className="controls">
          <button
            className="play"
            onClick={() => s.setPaused(!s.paused)}
            disabled={mpLocked}
            title={mpLocked ? mpLockTitle : undefined}
          >
            {s.paused ? "▶ Играть" : "❚❚ Пауза"}
          </button>
          <button className="ghost" onClick={onChangeDriver}>В хаб</button>
        </div>
      </header>

      <main className="layout">
        <div className="stage">
          {lastError && (
            <div className="error-toast" key={lastError.id}>{lastError.message}</div>
          )}
          <TrackCanvas snapshot={snap} heroId={s.heroId} trackId={trackId} weather={effWeather} timeOfDay={timeOfDay} />
          {tutorial && s.tutorialStep && s.tutorialStep.step !== dismissedTutStep && (
            <div className={`tutorial-banner${s.tutorialStep.highlight ? ` tutorial-hl-${s.tutorialStep.highlight}` : ""}`}>
              <button className="tut-dismiss" onClick={() => setDismissedTutStep(s.tutorialStep!.step)} aria-label="Скрыть подсказку">×</button>
              {s.tutorialStep.title && <strong>{s.tutorialStep.title}</strong>}
              {s.tutorialStep.text && <span>{s.tutorialStep.text}</span>}
            </div>
          )}
          {isStartSequence && s.startSequence && (
            <StartLights
              lightsOutAt={s.startSequence.lightsOutAt}
              sequenceId={s.startSequence.sequenceId}
              myStartResult={s.myStartResult}
              reacted={s.reacted}
              onReact={s.sendStartReaction}
            />
          )}
          {s.stage === "finished" && s.result && (
            <div className="overlay">
              <div className="card">
                <h2>Гонка завершена</h2>
                <ResultSummary result={s.result} heroId={s.heroId} />
                {s.lastProgression && <ProgressionCard progression={s.lastProgression} />}
                <div className="overlay-actions">
                  <button onClick={onChangeDriver}>В хаб</button>
                </div>
              </div>
            </div>
          )}
          {isRace && <HammerButton hero={heroCar} onRequest={s.requestHammer} />}
          {isQualy && tyreSelectShown && (
            <TyreSelectScreen
              forecast={s.forecast}
              onConfirm={(compound: TyreCompound) => {
                s.setStartingTyre(compound);
                setTyreSelectShown(false);
              }}
            />
          )}
        </div>

        <aside className="side">
          {snap && heroCar && isQualy && <QualyBoard snapshot={snap} heroId={s.heroId} />}
          {snap && heroCar && isRace && (
            <>
              <Telemetry snapshot={snap} hero={heroCar} grid={heroCar.gridPosition ?? heroCar.position ?? 0} />
              <PitPanel snapshot={snap} hero={heroCar} onPit={(c: TyreCompound) => s.requestPit(c)} onCancel={s.cancelPit} />
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

function ProgressionCard({ progression }: { progression: RaceProgression }) {
  const pct = progression.xpForNext > 0
    ? Math.min(100, (progression.xpIntoLevel / progression.xpForNext) * 100)
    : 0;
  return (
    <div className="progression">
      {progression.leveledUp && <div className="levelup">LEVEL UP!</div>}
      <div className="prog-xp">+{progression.xpGained} XP</div>
      <div className="xp-bar"><div className="xp-fill" style={{ width: `${pct}%` }} /></div>
      <div className="xp-frac">{progression.xpIntoLevel} / {progression.xpForNext} XP</div>
      <div className="prog-line">Уровень {progression.level} · {progression.division}</div>
      <div className="prog-line muted">Гонок сыграно: {progression.racesCount}</div>
    </div>
  );
}
