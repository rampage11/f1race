import type { CarSnapshot, RaceSnapshot } from "@f1race/race-engine";
import { formatGap, formatRaceTime, msToKmh, TYRE_LABEL } from "./colors";

export function Telemetry({ snapshot, hero, grid }: { snapshot: RaceSnapshot; hero: CarSnapshot; grid: number }) {
  const kmh = msToKmh(hero.v);
  return (
    <section className="panel telemetry">
      <h3>{hero.name}</h3>
      <div className="big">
        P{hero.position}
        <span className="of">/{snapshot.cars.length}</span>
      </div>
      <div className="grid-info">Старт: P{grid}</div>
      <div className="stats">
        <Stat label="Круг" value={`${Math.min(hero.lap + 1, snapshot.totalLaps)}/${snapshot.totalLaps}`} />
        <Stat label="Скорость" value={`${Math.round(kmh)} км/ч`} />
        <Stat label="Резина" value={TYRE_LABEL[hero.tyreCompound]} />
        <Stat label="Отрыв" value={formatGap(hero.gapAhead)} />
        <Stat label="Время" value={formatRaceTime(hero.raceTime)} />
        <Stat label="Обгоны" value={`${hero.overtakeScore}`} />
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
