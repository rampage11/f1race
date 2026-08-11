import { useEffect, useMemo, useRef, useState } from "react";
import type { TimeOfDay, TyreCompound, Weather } from "@f1race/race-engine";
import { TYRE_COLORS } from "./colors";
import type { SessionForecast } from "./useRaceSession";

const COUNTDOWN_SEC = 10;

const WEATHER_ICON: Record<Weather, string> = {
  dry: "☀️",
  lightRain: "🌦️",
  heavyRain: "⛈️",
  variable: "🌥️",
};

const WEATHER_LABEL: Record<Weather, string> = {
  dry: "Сухо",
  lightRain: "Слабый дождь",
  heavyRain: "Ливень",
  variable: "Переменная облачность",
};

const WEATHER_TIP: Record<Weather, string> = {
  dry: "Подходят слики (S / M / H)",
  lightRain: "Лучше intermediates",
  heavyRain: "Нужны wet",
  variable: "Дождь возможен — оцени риск",
};

const TOD_ICON: Record<TimeOfDay, string> = { day: "☀️", sunset: "🌇", night: "🌙" };
const TOD_LABEL: Record<TimeOfDay, string> = { day: "День", sunset: "Закат", night: "Ночь" };

interface CompoundOption {
  compound: TyreCompound;
  short: string;
  character: string;
}

const DRY_OPTIONS: CompoundOption[] = [
  { compound: "soft", short: "SOFT", character: "Быстрая" },
  { compound: "medium", short: "MEDIUM", character: "Универсальная" },
  { compound: "hard", short: "HARD", character: "Долговечная" },
];

const WET_OPTIONS: CompoundOption[] = [
  { compound: "intermediate", short: "INTER", character: "Дождевая-средняя" },
  { compound: "wet", short: "WET", character: "Дождевая" },
];

function isRainy(w: Weather): boolean {
  return w === "lightRain" || w === "heavyRain" || w === "variable";
}

export function recommendedCompoundFor(w: Weather): TyreCompound {
  switch (w) {
    case "dry":
      return "soft";
    case "lightRain":
      return "intermediate";
    case "heavyRain":
      return "wet";
    case "variable":
      return "medium";
  }
}

const RING_R = 34;
const RING_CIRC = 2 * Math.PI * RING_R;

export function TyreSelectScreen({ forecast, onConfirm }: {
  forecast: SessionForecast | null;
  onConfirm: (compound: TyreCompound) => void;
}) {
  const weather: Weather = forecast?.weather ?? "dry";
  const tod = forecast?.timeOfDay;
  const trackName = forecast?.trackName;
  const trackCountry = forecast?.trackCountry;

  const recommended = useMemo(() => recommendedCompoundFor(weather), [weather]);
  const rainy = isRainy(weather);
  const options = useMemo<CompoundOption[]>(
    () => (rainy ? [...DRY_OPTIONS, ...WET_OPTIONS] : DRY_OPTIONS),
    [rainy],
  );

  const [selected, setSelected] = useState<TyreCompound>(recommended);
  const [remaining, setRemaining] = useState(COUNTDOWN_SEC);
  const confirmedRef = useRef(false);

  const confirm = (compound: TyreCompound) => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm(compound);
  };

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, COUNTDOWN_SEC - elapsed);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        confirm(selected);
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wholeSec = Math.ceil(remaining);
  const progress = Math.min(1, Math.max(0, 1 - remaining / COUNTDOWN_SEC));
  const dashOffset = RING_CIRC * (1 - progress);

  return (
    <div className="ds-tyre-select">
      <div className="glass-panel ds-tyre-select-card ds-fade-in-up">
        <div className="ds-tyre-select-head">
          <div className="ds-tyre-countdown">
            <svg className="ds-tyre-count-ring" viewBox="0 0 80 80" width={72} height={72} aria-hidden="true">
              <circle cx="40" cy="40" r={RING_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
              <circle
                cx="40"
                cy="40"
                r={RING_R}
                fill="none"
                stroke="var(--accent-red)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 40 40)"
                style={{ transition: "stroke-dashoffset 0.12s linear" }}
              />
              <text
                x="40"
                y="46"
                textAnchor="middle"
                fill="#fff"
                fontFamily="JetBrains Mono, monospace"
                fontSize="24"
                fontWeight="700"
              >
                {wholeSec}
              </text>
            </svg>
          </div>
          <div className="ds-tyre-select-title">
            <h2 className="ds-heading">Выбор резины на гонку</h2>
            <p className="ds-muted">Подтвердите состав — он встанет на старте</p>
          </div>
        </div>

        <div className="ds-tyre-weather">
          <div className="ds-tyre-weather-main">
            <span className="ds-tyre-weather-icon">{WEATHER_ICON[weather]}</span>
            <div className="ds-tyre-weather-text">
              <span className="ds-heading">{WEATHER_LABEL[weather]}</span>
              <span className="ds-muted">{WEATHER_TIP[weather]}</span>
            </div>
          </div>
          <div className="ds-tyre-weather-chips">
            {trackName && (
              <span className="ds-topbar-chip">
                <span className="ds-topbar-flag">🏁</span>
                <span className="ds-heading">{trackName}</span>
                {trackCountry && <span className="ds-muted">· {trackCountry}</span>}
              </span>
            )}
            {tod && (
              <span className="ds-topbar-chip">
                <span>{TOD_ICON[tod]}</span>
                <span>{TOD_LABEL[tod]}</span>
              </span>
            )}
          </div>
        </div>

        <div className={`ds-tyre-select-grid${rainy ? " wet" : ""}`}>
          {options.map((opt) => {
            const color = TYRE_COLORS[opt.compound];
            const isSelected = selected === opt.compound;
            const isRecommended = recommended === opt.compound;
            const cls = [
              "ds-tyre-select-btn",
              isSelected ? "selected" : "",
              isRecommended ? "recommended" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={opt.compound}
                type="button"
                className={cls}
                onClick={() => setSelected(opt.compound)}
                style={{ borderColor: color }}
              >
                {isRecommended && <span className="ds-tyre-rec-badge">★</span>}
                {isSelected && <span className="ds-tyre-check">✓</span>}
                <span className="ds-tyre-select-dot" style={{ background: color }} />
                <span className="ds-tyre-select-short">{opt.short}</span>
                <span className="ds-tyre-select-char">{opt.character}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="neon-button ds-tyre-confirm"
          onClick={() => confirm(selected)}
        >
          Подтвердить · {selected.toUpperCase()}
        </button>
      </div>
    </div>
  );
}
