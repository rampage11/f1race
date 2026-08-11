import { useEffect, useRef, useState } from "react";
import type { PilotProfile, RaceEvent, TyreCompound, TimeOfDay, Weather } from "@f1race/race-engine";
import { formatRaceTime } from "./colors";
import { HammerButton } from "./HammerButton";
import { PitPanel } from "./PitPanel";
import { PushStrategySelect } from "./PushStrategySelect";
import { QualyBoard } from "./QualyBoard";
import { Standings } from "./Standings";
import type { HeroFlash } from "./Standings";
import { StartLights } from "./StartLights";
import { Telemetry } from "./Telemetry";
import { TrackCanvas } from "./TrackCanvas";
import type { FlashKind, TrackCanvasHandle } from "./TrackCanvas";
import { LobbyScreen } from "./LobbyScreen";
import { TyreSelectScreen, recommendedCompoundFor } from "./TyreSelectScreen";
import { WeatherPitPrompt } from "./WeatherPitPrompt";
import { useRaceSession } from "./useRaceSession";
import type { RaceProgression, Stage } from "./useRaceSession";
import { RaceAudio } from "./audio";
import { isTouchDevice } from "./device";

const IS_TOUCH = isTouchDevice();
const CAM_KEY = "f1race.camera.heroCam";

function readHeroCamPref(): boolean {
  try {
    return localStorage.getItem(CAM_KEY) === "1";
  } catch {
    return false;
  }
}
function writeHeroCamPref(on: boolean): void {
  try {
    localStorage.setItem(CAM_KEY, on ? "1" : "0");
  } catch {
    /* localStorage unavailable */
  }
}

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
  dry: "Сухо", lightRain: "Малый дождь", heavyRain: "Ливень", variable: "Переменная",
};

export function RaceView({ hero, guestId, onChangeDriver, tutorial, equipped }: { hero: PilotProfile; guestId: string; onChangeDriver: () => void; tutorial?: boolean; equipped?: { accentColor?: string; carNumber?: string } }) {
  const s = useRaceSession(hero, guestId, tutorial ? "tutorial" : "race");
  const snap = s.snapshot;
  const heroCar = snap?.cars.find((c) => c.driverId === s.heroId) ?? null;
  const isQualy = s.stage === "qualy";
  const isRace = s.stage === "race";
  const isStartSequence = s.stage === "startSequence";

  // S2-1 audio: cosmetic-only Web Audio engine. Created once, fed snapshots,
  // started on the first user gesture (browsers block autoplay).
  const audioRef = useRef<RaceAudio | null>(null);
  if (audioRef.current === null) audioRef.current = new RaceAudio();
  const audio = audioRef.current;
  const [audioMuted, setAudioMuted] = useState<boolean>(audio.muted);

  useEffect(() => {
    const startOnce = () => {
      audio.start();
      setAudioMuted(audio.muted);
    };
    window.addEventListener("pointerdown", startOnce, { once: true });
    window.addEventListener("keydown", startOnce, { once: true });
    return () => {
      window.removeEventListener("pointerdown", startOnce);
      window.removeEventListener("keydown", startOnce);
    };
  }, [audio]);

  useEffect(() => {
    audio.update(snap ?? null, s.heroId);
  }, [audio, snap, s.heroId]);

  useEffect(() => () => audio.destroy(), [audio]);

  const toggleMute = () => {
    const m = audio.toggleMute();
    audio.start();
    setAudioMuted(m);
  };

  // S2-2 hero-cam: purely a view transform on the canvas.
  const [heroCam, setHeroCam] = useState<boolean>(() => readHeroCamPref());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "c" || e.key === "C" || e.key === "с" || e.key === "С") {
        const target = document.activeElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        e.preventDefault();
        setHeroCam((v) => {
          const next = !v;
          writeHeroCamPref(next);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggleHeroCam = () => {
    setHeroCam((v) => {
      const next = !v;
      writeHeroCamPref(next);
      return next;
    });
  };

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

  // S1-2: track whether the hero has pitted this race (client-side UX nudge; the
  // authoritative DSQ is computed server-side). Reset on each fresh race.
  const [heroPitted, setHeroPitted] = useState(false);
  useEffect(() => {
    if (heroCar && (heroCar.inPits || heroCar.pitPending)) setHeroPitted(true);
  }, [heroCar?.inPits, heroCar?.pitPending]);

  // S1-3: detect a mid-race dry→rain effectiveWeather change and surface a one-shot
  // dismissible pit prompt. prevEffectiveWeather is tracked here so the overlay state
  // (dismiss/selected compound) stays coherent in one component.
  const [weatherPrompt, setWeatherPrompt] = useState<{ weather: Weather; recommended: TyreCompound } | null>(null);
  const prevWeatherRef = useRef<Weather | null>(null);
  const weatherPromptShownForRef = useRef<Weather | null>(null);

  const prevStageRef = useRef<Stage>(s.stage);
  useEffect(() => {
    if (prevStageRef.current !== "race" && s.stage === "race") {
      setHeroPitted(false);
      setWeatherPrompt(null);
      prevWeatherRef.current = null;
      weatherPromptShownForRef.current = null;
    }
    prevStageRef.current = s.stage;
  }, [s.stage]);

  useEffect(() => {
    if (s.stage !== "race") return;
    const w = snap?.effectiveWeather;
    if (!w) return;
    const prev = prevWeatherRef.current;
    prevWeatherRef.current = w;
    if (prev && prev === "dry" && (w === "lightRain" || w === "heavyRain")) {
      if (weatherPromptShownForRef.current !== w) {
        weatherPromptShownForRef.current = w;
        setWeatherPrompt({ weather: w, recommended: recommendedCompoundFor(w) });
      }
    }
  }, [s.stage, snap?.effectiveWeather]);

  // S2-3 overtake cinematics: dispatch from the delta-encoded event batch.
  // prevEventSeqRef guards against re-processing on React re-renders (the
  // snapshot object identity changes but the events array is the same delta).
  const trackCanvasRef = useRef<TrackCanvasHandle | null>(null);
  const prevEventSeqRef = useRef<number>(0);
  const [eventToasts, setEventToasts] = useState<EventToast[]>([]);
  const [heroFlash, setHeroFlash] = useState<HeroFlash | null>(null);
  const toastIdRef = useRef(0);
  const flashIdRef = useRef(0);

  useEffect(() => {
    if (s.stage !== "race") {
      prevEventSeqRef.current = 0;
      return;
    }
    const events = snap?.events;
    if (!events || events.length === 0) return;
    const heroId = s.heroId;
    let highest = prevEventSeqRef.current;
    for (const ev of events) {
      if (ev.seq <= prevEventSeqRef.current) continue;
      if (ev.seq > highest) highest = ev.seq;
      dispatchRaceEvent(ev, {
        heroId,
        heroPos: snap?.cars.find((c) => c.driverId === heroId)?.position ?? null,
        audio,
        canvas: trackCanvasRef.current,
        pushToast: (t) => {
          const id = ++toastIdRef.current;
          setEventToasts((prev) => [...prev.slice(-2), { ...t, id }]);
          const ttl = t.ttlMs ?? 1500;
          setTimeout(() => {
            setEventToasts((prev) => prev.filter((x) => x.id !== id));
          }, ttl);
        },
        pulseHero: (kind: FlashKind) => {
          setHeroFlash({ id: ++flashIdRef.current, kind });
        },
      });
    }
    if (highest !== prevEventSeqRef.current) prevEventSeqRef.current = highest;
  }, [snap?.events, snap?.cars, s.stage, s.heroId, audio]);

  useEffect(() => {
    if (!heroFlash) return;
    const t = setTimeout(() => setHeroFlash(null), 800);
    return () => clearTimeout(t);
  }, [heroFlash]);

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
  const dsqAtRisk = isRace
    && !!heroCar
    && !heroCar.finished
    && !heroPitted
    && !!snap?.totalLaps
    && (heroCar?.lap ?? 0) >= ((snap?.totalLaps ?? 0) - 2);

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
            className={`icon-btn${heroCam ? " active" : ""}`}
            onClick={toggleHeroCam}
            title={IS_TOUCH ? "Камера: герой" : "Камера: герой (C)"}
            aria-label="Камера: герой"
            aria-pressed={heroCam}
          >
            {heroCam ? "🎯" : "🗺️"}
          </button>
          <button
            className={`icon-btn${audioMuted ? "" : " active"}`}
            onClick={toggleMute}
            title={audioMuted ? "Включить звук" : "Выключить звук"}
            aria-label={audioMuted ? "Включить звук" : "Выключить звук"}
            aria-pressed={!audioMuted}
          >
            {audioMuted ? "🔇" : "🔊"}
          </button>
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
          {eventToasts.length > 0 && (
            <div className="event-toast-stack" aria-live="polite">
              {eventToasts.map((t) => (
                <div key={t.id} className={`event-toast ${t.kind}`}>
                  {t.text}
                </div>
              ))}
            </div>
          )}
          {dsqAtRisk && (
            <div className="dsq-warn" role="alert">
              <span className="dsq-warn-icon">⚠️</span>
              <span className="dsq-warn-text">
                ВНИМАНИЕ: вы не заезжали на пит — на финише <strong>ДИСКВАЛИФИКАЦИЯ</strong>! Откройте панель пит-стопа.
              </span>
            </div>
          )}
          <TrackCanvas ref={trackCanvasRef} snapshot={snap} heroId={s.heroId} trackId={trackId} weather={effWeather} timeOfDay={timeOfDay} heroCam={heroCam} paused={s.paused} equipped={equipped} />
          {tutorial && s.tutorialStep && s.tutorialStep.step !== dismissedTutStep && (() => {
            const step = s.tutorialStep!;
            const highlightClass = step.highlight
              ? `tutorial-hl-${step.highlight}`
              : step.step === "strategy_intro"
                ? "tutorial-hl-strategy"
                : "";
            return (
              <div className={`tutorial-banner${highlightClass ? ` ${highlightClass}` : ""}`}>
                <button className="tut-dismiss" onClick={() => setDismissedTutStep(step.step)} aria-label="Скрыть подсказку">×</button>
                {step.title && <strong>{step.title}</strong>}
                {step.text && <span>{step.text}</span>}
              </div>
            );
          })()}
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
          {isRace && (
            <PushStrategySelect
              current={heroCar?.pushStrategy}
              disabled={!heroCar || heroCar.finished || heroCar.inPits}
              onSelect={s.setPushLevel}
            />
          )}
          {isRace && weatherPrompt && (
            <WeatherPitPrompt
              weather={weatherPrompt.weather}
              onConfirm={(compound: TyreCompound) => {
                s.requestPit(compound);
                setWeatherPrompt(null);
              }}
              onDismiss={() => setWeatherPrompt(null)}
            />
          )}
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
              <Standings snapshot={snap} heroId={s.heroId} heroFlash={heroFlash} />
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
      {progression.leveledUp && <div className="levelup">НОВЫЙ УРОВЕНЬ!</div>}
      <div className="prog-xp">+{progression.xpGained} XP</div>
      <div className="xp-bar"><div className="xp-fill" style={{ width: `${pct}%` }} /></div>
      <div className="xp-frac">{progression.xpIntoLevel} / {progression.xpForNext} XP</div>
      <div className="prog-line">Уровень {progression.level} · {progression.division}</div>
      <div className="prog-line muted">Гонок сыграно: {progression.racesCount}</div>
    </div>
  );
}

type ToastKind = "gain" | "loss" | "gold" | "info";

interface EventToast {
  id: number;
  text: string;
  kind: ToastKind;
  ttlMs?: number;
}

interface DispatchCtx {
  heroId: string;
  heroPos: number | null;
  audio: RaceAudio;
  canvas: TrackCanvasHandle | null;
  pushToast: (t: Omit<EventToast, "id">) => void;
  pulseHero: (kind: FlashKind) => void;
}

function dispatchRaceEvent(ev: RaceEvent, ctx: DispatchCtx): void {
  const { heroId, heroPos, audio, canvas, pushToast, pulseHero } = ctx;
  switch (ev.type) {
    case "overtake": {
      const isAttacker = ev.attackerId === heroId;
      const isVictim = ev.victimId === heroId;
      if (!isAttacker && !isVictim) return;
      const kind: FlashKind = isAttacker ? "gain" : "loss";
      canvas?.flashCar(heroId, kind);
      pulseHero(kind);
      if (heroPos != null) {
        const fromPos = isAttacker ? heroPos + 1 : heroPos - 1;
        const toPos = heroPos;
        if (isAttacker) {
          audio.triggerOvertake();
          pushToast({ text: `P${fromPos} → P${toPos}! ↑`, kind: "gain", ttlMs: 1500 });
        } else {
          audio.triggerPositionLost();
          pushToast({ text: `P${fromPos} → P${toPos} ↓`, kind: "loss", ttlMs: 1500 });
        }
      } else if (isAttacker) {
        audio.triggerOvertake();
      } else {
        audio.triggerPositionLost();
      }
      break;
    }
    case "fastest_lap": {
      if (ev.driverId !== heroId) return;
      pushToast({ text: "БЫСТРЕЙШИЙ КРУГ! ⚡", kind: "gold", ttlMs: 2000 });
      break;
    }
    case "info": {
      pushToast({ text: ev.message, kind: "info", ttlMs: 2800 });
      break;
    }
    default:
      break;
  }
}
