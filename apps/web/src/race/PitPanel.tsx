import type { TyreCompound } from "@f1race/race-engine";
import { estimateTyreLifespanLaps, redBullRing, CONFIG } from "@f1race/race-engine";
import type { SessionCar, SessionSnapshot } from "./useRaceSession";
import { TYRE_COLORS, TYRE_LABEL } from "./colors";

const COMPOUNDS: TyreCompound[] = ["soft", "medium", "hard", "intermediate", "wet"];
const LAP_KM = redBullRing().lengthM / 1000;
const PIT_DELTA = redBullRing().pitLaneDelta;

function lapsLeft(car: SessionCar): number {
  if (!car.tyreCompound) return 0;
  const cfg = CONFIG.tyres[car.tyreCompound];
  const total = cfg.cliff;
  const remaining = Math.max(0, (total - (car.tyreWear ?? 0)) / Math.max(0.0001, total / estimateTyreLifespanLaps(car.tyreCompound, 0, LAP_KM)));
  return Math.ceil(remaining);
}

export function PitPanel({
  snapshot,
  hero,
  onPit,
  onCancel,
}: {
  snapshot: SessionSnapshot;
  hero: SessionCar;
  onPit: (c: TyreCompound) => void;
  onCancel: () => void;
}) {
  const disabled = snapshot.stage !== "race" || hero.finished || hero.inPits;
  const compound = hero.tyreCompound ?? "medium";
  const onCliff = (hero.tyreWear ?? 0) >= CONFIG.tyres[compound].cliff;
  const currentCompound = compound;
  return (
    <section className="glass-panel ds-pit">
      <h3 className="ds-heading">Пит-стоп</h3>
      <div className="ds-tyre-wear">
        <div className="ds-tyre-wear-head">
          <span className="ds-tyre-dot" style={{ background: TYRE_COLORS[compound] }} />
          <span className="ds-tyre-wear-name">{TYRE_LABEL[compound]}</span>
          <span>≈ {lapsLeft(hero)} круг. до деградации</span>
        </div>
        <div className={`ds-bar ${onCliff ? "ds-bar-cliff" : ""}`}>
          <div
            className="ds-bar-fill"
            style={{ width: `${Math.round((hero.tyreWear ?? 0) * 100)}%`, background: onCliff ? "var(--accent-red)" : TYRE_COLORS[compound] }}
          />
        </div>
        <small className={onCliff ? "warn-text" : "ds-muted"}>
          Износ {Math.round((hero.tyreWear ?? 0) * 100)}%{onCliff ? " — резина «поплыла», срочно на пит-стоп!" : ""}
        </small>
      </div>

      {hero.inPits && (
        <div className="ds-pit-active">В боксах… {(hero.pitTimer ?? 0).toFixed(1)} c</div>
      )}
      {hero.pitPending && !hero.inPits && (
        <div className="ds-pit-pending">Заезд на следующем круге</div>
      )}

      <div className="ds-tyre-buttons">
        {COMPOUNDS.map((c) => {
          const same = c === currentCompound;
          return (
            <button
              key={c}
              className="ds-tyre-btn"
              disabled={disabled}
              title={same ? "Поставить свежий комплект того же состава" : undefined}
              style={{ borderColor: TYRE_COLORS[c], outline: same ? `2px solid ${TYRE_COLORS[c]}` : undefined, outlineOffset: "1px" }}
              onClick={() => onPit(c)}
            >
              <span className="dot" style={{ background: TYRE_COLORS[c] }} />
              {TYRE_LABEL[c]}{same ? " · текущий" : ""}
            </button>
          );
        })}
      </div>
      <button className="ds-pit-cancel" disabled={!hero.pitPending || hero.inPits} onClick={onCancel}>
        Отменить пит
      </button>
      <p className="ds-hint">
        Пит-стоп стоит ~{PIT_DELTA} с. Рекомендуется сменить состав; пит-стоп без смены состава — штраф 30 с, а без пит-стопа — дисквалификация. Inter/Wet — для дождя.
      </p>
    </section>
  );
}
