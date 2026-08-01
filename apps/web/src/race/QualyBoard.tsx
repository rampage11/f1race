import type { SessionSnapshot } from "./useRaceSession";
import { teamColor } from "./colors";

const PHASE_LABEL: Record<string, string> = {
  waiting: "ожидание",
  outlap: "прогрев",
  hotlap: "боевой",
  inlap: "возврат",
  done: "финишировал",
};

export function QualyBoard({ snapshot, heroId }: { snapshot: SessionSnapshot; heroId: string }) {
  const ranked = [...snapshot.cars].sort((a, b) => {
    const at = a.bestLapTime ?? Number.POSITIVE_INFINITY;
    const bt = b.bestLapTime ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.name.localeCompare(b.name);
  });
  return (
    <section className="panel standings">
      <h3>Квалификация · лучшие круги</h3>
      <div className="list">
        {ranked.map((c, i) => (
          <div key={c.driverId} className={`row ${c.driverId === heroId ? "hero" : ""} ${c.inPits ? "pitting" : ""}`}>
            <span className="pos">{c.bestLapTime != null ? i + 1 : "·"}</span>
            <span className="team-dot" style={{ background: teamColor(c.team) }} />
            <span className="name">{c.name}</span>
            <span className="tyre" style={{ color: "#94a3b8" }}>{PHASE_LABEL[c.phase ?? "waiting"]}</span>
            <span className="gap">{c.bestLapTime != null ? `${c.bestLapTime.toFixed(2)}с` : "—"}</span>
          </div>
        ))}
      </div>
      <p className="hint">Машины выезжают из боксов с интервалом 5 c, проходят круг прогрева и боевой круг.</p>
    </section>
  );
}
