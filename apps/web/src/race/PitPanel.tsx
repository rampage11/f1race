import type { CarSnapshot, RaceSnapshot, TyreCompound } from "@f1race/race-engine";
import { estimateTyreLifespanLaps, redBullRing, CONFIG } from "@f1race/race-engine";
import { TYRE_COLORS, TYRE_LABEL } from "./colors";

const COMPOUNDS: TyreCompound[] = ["soft", "medium", "hard"];
const LAP_KM = redBullRing().lengthM / 1000;
const PIT_DELTA = redBullRing().pitLaneDelta;

function lapsLeft(car: CarSnapshot): number {
  const cfg = CONFIG.tyres[car.tyreCompound];
  const total = cfg.cliff;
  const remaining = Math.max(0, (total - car.tyreWear) / Math.max(0.0001, total / estimateTyreLifespanLaps(car.tyreCompound, 0, LAP_KM)));
  return Math.ceil(remaining);
}

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
  const onCliff = hero.tyreWear >= CONFIG.tyres[hero.tyreCompound].cliff;
  const currentCompound = hero.tyreCompound;
  return (
    <section className="panel">
      <h3>Пит-стоп</h3>
      <div className="tyre-wear">
        <span>
          Резина: {TYRE_LABEL[hero.tyreCompound]} · ≈ {lapsLeft(hero)} круг. до деградации
        </span>
        <div className={`bar ${onCliff ? "bar-cliff" : ""}`}>
          <div
            className="fill"
            style={{ width: `${Math.round(hero.tyreWear * 100)}%`, background: onCliff ? "#ef4444" : TYRE_COLORS[hero.tyreCompound] }}
          />
        </div>
        <small className={onCliff ? "warn-text" : ""}>
          Износ {Math.round(hero.tyreWear * 100)}%{onCliff ? " — резина «поплыла», срочно питься!" : ""}
        </small>
      </div>

      {hero.inPits && (
        <div className="pitting">В боксах… {hero.pitTimer.toFixed(1)} c</div>
      )}
      {hero.pitPending && !hero.inPits && (
        <div className="pending">Заезд на следующем круге</div>
      )}

      <div className="tyre-buttons">
        {COMPOUNDS.map((c) => {
          const same = c === currentCompound;
          return (
            <button
              key={c}
              className="tyre-btn"
              disabled={disabled || same}
              title={same ? "Нельзя поставить тот же состав (правило Ф1)" : undefined}
              style={{ borderColor: TYRE_COLORS[c], opacity: same ? 0.35 : 1 }}
              onClick={() => onPit(c)}
            >
              <span className="dot" style={{ background: TYRE_COLORS[c] }} />
              {TYRE_LABEL[c]}
            </button>
          );
        })}
      </div>
      <button className="cancel" disabled={!hero.pitPending || hero.inPits} onClick={onCancel}>
        Отменить пит
      </button>
      <p className="hint">
        Пит-стоп стоит ~{PIT_DELTA} c. Обязательна смена состава (правило Ф1). Текущий состав ({TYRE_LABEL[currentCompound]}) недоступен.
      </p>
    </section>
  );
}
