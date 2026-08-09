import { useEffect, useState } from "react";
import type { PilotProfile, TimeOfDay, Weather } from "@f1race/race-engine";
import { teamColor } from "./colors";
import type { ConnectionState, LobbyState, SessionForecast } from "./useRaceSession";

const WEATHER_ICON: Record<Weather, string> = {
  dry: "☀️", lightRain: "🌦️", heavyRain: "⛈️", variable: "🌤️",
};
const WEATHER_LABEL: Record<Weather, string> = {
  dry: "Сухо", lightRain: "Малый дождь", heavyRain: "Ливень", variable: "Переменная",
};
const TOD_ICON: Record<TimeOfDay, string> = { day: "День", sunset: "Закат", night: "Ночь" };
const COUNTRY_FLAGS: Record<string, string> = { AT: "🇦🇹", IT: "🇮🇹", MC: "🇲🇨", BR: "🇧🇷" };

const R = 54;
const CIRC = 2 * Math.PI * R;

export function LobbyScreen({ hero, lobby, connectionState, forecast }: {
  hero: PilotProfile;
  lobby: LobbyState | null;
  connectionState: ConnectionState;
  forecast: SessionForecast | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, []);

  const disconnected = connectionState === "disconnected";
  const reconnecting = connectionState === "reconnecting";
  const title = disconnected ? "Связь потеряна" : reconnecting ? "Переподключение" : "Поиск гонки";

  const queued = lobby?.queuedPlayers ?? 0;
  const status = disconnected || reconnecting
    ? "Восстановление соединения…"
    : queued <= 1 ? "Поиск игроков…"
    : queued < 4 ? "Добор соперников…"
    : "Старт скоро…";

  const progress = Math.min(1, elapsed / 30);
  const dashOffset = CIRC * (1 - progress);

  return (
    <div className="ds-lobby">
      <div className="glass-panel ds-lobby-card ds-fade-in-up">
        <div className="ds-lobby-brand">
          {hero.name} <span className="team-dot-inline" style={{ background: teamColor(hero.team) }} /> · {hero.team}
        </div>
        <div className={`ds-lobby-division ${lobby ? "" : "muted"}`}>{lobby ? lobby.division : "—"}</div>

        <div className="ds-lobby-ring-wrap">
          <svg className="ds-lobby-ring" viewBox="0 0 128 128" width={128} height={128}>
            <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="6" />
            <circle
              cx="64" cy="64" r={R} fill="none"
              stroke="var(--accent-red)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 64 64)"
            />
            <text x="64" y="66" textAnchor="middle" className="ds-lobby-ring-time" fill="#fff" fontFamily="JetBrains Mono, monospace" fontSize="26" fontWeight="600">{elapsed}</text>
            <text x="64" y="84" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="9" letterSpacing="1">СЕК</text>
          </svg>
        </div>

        <h2 className="ds-heading ds-lobby-title">{title}</h2>
        <p className="ds-lobby-status">{status}</p>

        {forecast && (forecast.trackName || forecast.weather || forecast.timeOfDay) && (
          <div className="ds-lobby-forecast">
            {forecast.trackName && (
              <div className="ds-forecast-row">
                <span className="ds-topbar-flag">{COUNTRY_FLAGS[forecast.trackCountry ?? ""] ?? "🏁"}</span>
                <span className="ds-heading">{forecast.trackName}</span>
                {forecast.laps && <span className="ds-muted">· {forecast.laps} кругов</span>}
              </div>
            )}
            {forecast.weather && (
              <div className="ds-forecast-row">
                <span>{WEATHER_ICON[forecast.weather]}</span>
                <span>{WEATHER_LABEL[forecast.weather]}</span>
              </div>
            )}
            {forecast.timeOfDay && (
              <div className="ds-forecast-row">
                <span>{TOD_ICON[forecast.timeOfDay]}</span>
              </div>
            )}
          </div>
        )}

        {lobby ? (
          <div className="ds-lobby-info">
            <div>Игроков в очереди: <strong>{lobby.queuedPlayers}</strong></div>
            <div>Ожидание ~{lobby.estimatedWaitSec} с</div>
          </div>
        ) : (
          <p className="ds-muted">Подбираем соперников вашего уровня…</p>
        )}
        <p className="ds-hint">Гонка начнётся автоматически, когда найдутся соперники</p>
      </div>
    </div>
  );
}
