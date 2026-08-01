import type { SessionSnapshot } from "./useRaceSession";
import { formatGap, teamColor, TYRE_COLORS, TYRE_LABEL } from "./colors";

export function Standings({
  snapshot,
  heroId,
}: {
  snapshot: SessionSnapshot;
  heroId: string;
}) {
  return (
    <section className="panel standings">
      <h3>Позиции</h3>
      <div className="list">
        {snapshot.cars.map((c) => (
          <div key={c.driverId} className={`row ${c.driverId === heroId ? "hero" : ""} ${c.inPits ? "pitting" : ""}`}>
            <span className="pos">{c.finished ? "🏁" : c.position ?? "-"}</span>
            <span className="team-dot" style={{ background: teamColor(c.team) }} />
            <span className="name">{c.name}</span>
            <span className="tyre" style={{ color: c.tyreCompound === "hard" ? "#64748b" : c.tyreCompound ? TYRE_COLORS[c.tyreCompound] : "#64748b" }}>
              {c.tyreCompound ? TYRE_LABEL[c.tyreCompound][0] : "·"}
            </span>
            <span className="gap">{c.driverId === heroId ? "" : formatGap(c.gapAhead ?? 0)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
