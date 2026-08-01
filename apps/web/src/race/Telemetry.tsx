import type { SessionCar, SessionSnapshot } from "./useRaceSession";
import { formatGap, formatRaceTime, msToKmh, TYRE_LABEL } from "./colors";

export function Telemetry({ snapshot, hero, grid }: { snapshot: SessionSnapshot; hero: SessionCar; grid: number }) {
  const kmh = msToKmh(hero.v);
  const tyre = hero.tyreCompound ? TYRE_LABEL[hero.tyreCompound] : "—";
  const lap = hero.lap ?? 0;
  const totalLaps = snapshot.totalLaps ?? 0;
  const pos = hero.position ?? 0;
  return (
    <section className="panel telemetry">
      <h3>{hero.name}</h3>
      <div className="big">
        P{pos}
        <span className="of">/{snapshot.cars.length}</span>
      </div>
      <div className="grid-info">Старт: P{grid}</div>
      <div className="stats">
        <Stat label="Круг" value={`${Math.min(lap + 1, totalLaps || lap + 1)}/${totalLaps}`} />
        <Stat label="Скорость" value={`${Math.round(kmh)} км/ч`} />
        <Stat label="Резина" value={tyre} />
        <Stat label="Отрыв" value={formatGap(hero.gapAhead ?? 0)} />
        <Stat label="Время" value={formatRaceTime(snapshot.time)} />
        <Stat label="Обгоны" value={`${hero.overtakeScore ?? 0}`} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}
