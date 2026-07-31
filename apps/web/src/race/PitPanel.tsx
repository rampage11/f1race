import type { CarSnapshot, RaceSnapshot, TyreCompound } from "@f1race/race-engine";
import { TYRE_COLORS, TYRE_LABEL } from "./colors";

const COMPOUNDS: TyreCompound[] = ["soft", "medium", "hard"];

export function PitPanel({
  snapshot,
  hero,
  onPit,
  onCancel,
}: {
  snapshot: RaceSnapshot;
  hero: CarSnapshot;
  onPit: (c: TyreCompound) => void;
  onCancel: () => void;
}) {
  const disabled = snapshot.phase !== "racing" || hero.finished || hero.inPits;
  return (
    <section className="panel">
      <h3>Пит-стоп</h3>
      <div className="tyre-wear">
        <span>Резина: {TYRE_LABEL[hero.tyreCompound]}</span>
        <div className="bar">
          <div
            className="fill"
            style={{ width: `${Math.round(hero.tyreWear * 100)}%`, background: TYRE_COLORS[hero.tyreCompound] }}
          />
        </div>
        <small>Износ {Math.round(hero.tyreWear * 100)}%</small>
      </div>

      {hero.inPits && (
        <div className="pitting">В боксах… {hero.pitTimer.toFixed(1)} c</div>
      )}
      {hero.pitPending && !hero.inPits && (
        <div className="pending">Заезд на следующем круге</div>
      )}

      <div className="tyre-buttons">
        {COMPOUNDS.map((c) => (
          <button
            key={c}
            className="tyre-btn"
            disabled={disabled}
            style={{ borderColor: TYRE_COLORS[c], color: c === "hard" ? "#0b1220" : TYRE_COLORS[c] }}
            onClick={() => onPit(c)}
          >
            <span className="dot" style={{ background: TYRE_COLORS[c] }} />
            {TYRE_LABEL[c]}
          </button>
        ))}
      </div>
      <button className="cancel" disabled={!hero.pitPending || hero.inPits} onClick={onCancel}>
        Отменить пит
      </button>
      <p className="hint">Пит-стоп стоит ~22 c (потеря в круге) и обязателен минимум один раз.</p>
    </section>
  );
}
