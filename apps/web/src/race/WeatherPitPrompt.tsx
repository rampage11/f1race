import { useState } from "react";
import type { TyreCompound, Weather } from "@f1race/race-engine";
import { TYRE_COLORS, TYRE_LABEL } from "./colors";
import { recommendedCompoundFor } from "./TyreSelectScreen";

const COMPOUNDS: TyreCompound[] = ["soft", "medium", "hard", "intermediate", "wet"];

const WEATHER_ICON: Record<Weather, string> = {
  dry: "☀️",
  lightRain: "🌦️",
  heavyRain: "⛈️",
  variable: "🌤️",
};

const WEATHER_LABEL: Record<Weather, string> = {
  dry: "Сухо",
  lightRain: "Дождь",
  heavyRain: "Ливень",
  variable: "Переменная",
};

export function WeatherPitPrompt({
  weather,
  onConfirm,
  onDismiss,
}: {
  weather: Weather;
  onConfirm: (compound: TyreCompound) => void;
  onDismiss: () => void;
}) {
  const recommended = recommendedCompoundFor(weather);
  const [selected, setSelected] = useState<TyreCompound>(recommended);

  return (
    <div className="ds-weather-prompt" role="dialog" aria-label="Смена резины">
      <div className="glass-panel ds-weather-prompt-card ds-fade-in-up">
        <div className="ds-weather-prompt-head">
          <span className="ds-weather-prompt-icon">{WEATHER_ICON[weather]}</span>
          <div className="ds-weather-prompt-title">
            <h2 className="ds-heading">Погода меняется — {WEATHER_LABEL[weather]}!</h2>
            <p className="ds-muted">Слик потеряет сцепление. Сменить резину на пит-стопе?</p>
          </div>
        </div>

        <div className="ds-weather-prompt-grid">
          {COMPOUNDS.map((c) => {
            const color = TYRE_COLORS[c];
            const isSelected = selected === c;
            const isRecommended = recommended === c;
            const cls = [
              "ds-weather-prompt-btn",
              isSelected ? "selected" : "",
              isRecommended ? "recommended" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={c}
                type="button"
                className={cls}
                onClick={() => setSelected(c)}
                style={{ borderColor: color }}
              >
                {isRecommended && <span className="ds-tyre-rec-badge">★</span>}
                {isSelected && <span className="ds-tyre-check">✓</span>}
                <span className="ds-tyre-select-dot" style={{ background: color }} />
                <span className="ds-tyre-select-short">{TYRE_LABEL[c]}</span>
              </button>
            );
          })}
        </div>

        <div className="ds-weather-prompt-actions">
          <button type="button" className="neon-button ds-weather-prompt-confirm" onClick={() => onConfirm(selected)}>
            Пит-стоп · {selected.toUpperCase()}
          </button>
          <button type="button" className="ds-weather-prompt-dismiss" onClick={onDismiss}>
            Остаться на треке
          </button>
        </div>
      </div>
    </div>
  );
}
