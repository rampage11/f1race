import { RaceEngine, buildRaceConfig, emptySkills, makeBot, makeDriver, mulberry32, redBullRing, baseLapTime, runQualifying, type Driver } from "../src/index.js";

function field(seed: number): Driver[] {
  const rng = mulberry32(seed);
  const bots: Driver[] = [];
  for (let i = 0; i < 19; i++) bots.push(makeBot({}, rng));
  const hero = makeDriver({ name: "Hero", country: "RU", kind: "human", skills: { ...emptySkills(), pace: 3, attack: 2, defense: 2, fitness: 1, reaction: 1, tyreMgmt: 1 }, startingTyre: "medium", pitPlan: { targetStops: 1, strategy: "flexible", compound: "soft" } });
  return [hero, ...bots];
}

function gridOf(field: Driver[], seed: number): Driver[] {
  const track = redBullRing();
  const t0 = baseLapTime(track);
  const q = runQualifying(field, t0, mulberry32(seed * 7 + 1));
  return q.map((r) => field.find((d) => d.id === r.driverId)!).sort((a, b) => q.find((x) => x.driverId === a.id)!.gridPosition - q.find((x) => x.driverId === b.id)!.gridPosition);
}

const seeds = [1, 2, 3];
let sumSpread = 0;
let sumNeighborAvg = 0;
let count = 0;
for (const seed of seeds) {
  const grid = gridOf(field(seed), seed);
  const cfg = buildRaceConfig({ track: redBullRing(), drivers: grid, totalLaps: 12, seed: seed * 13 + 5, dt: 0.1 });
  const result = new RaceEngine(cfg).run();
  const classified = result.rows.filter((r) => !r.dnf && Number.isFinite(r.raceTime));
  const dnfCount = result.rows.length - classified.length;
  const times = classified.map((r) => r.raceTime).sort((a, b) => a - b);
  const total = times.length >= 2 ? times[times.length - 1]! - times[0]! : 0;
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
  const max = gaps.length ? gaps[gaps.length - 1]! : 0;
  sumSpread += total;
  sumNeighborAvg += median;
  count++;
  const dnfTag = dnfCount ? ` | ${dnfCount} DNF` : "";
  console.log(`seed ${seed}: P1→P${classified.length} = ${total.toFixed(1)}s | median neighbor ${median.toFixed(2)}s | max neighbor ${max.toFixed(1)}s${dnfTag}`);
  if (seed === 1) {
    console.log("  finish times:", times.map((t) => t.toFixed(1)).join(" "));
    const sortedGrid = grid;
    void sortedGrid;
    console.log("  paceFactors:", grid.map((d) => d.paceFactor.toFixed(4)).join(" "));
    const eng = new RaceEngine(cfg);
    eng.run();
    const snap = eng.snapshot();
    const byId = new Map(grid.map((d) => [d.id, d]));
    const ranked = [...snap.cars].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
    console.log("  per-car (finish order):");
    for (const c of ranked) {
      const drv = byId.get(c.driverId)!;
      const row = result.rows.find((r) => r.driverId === c.driverId)!;
      console.log(`    P${c.position} ${drv.name.padEnd(16)} start=${drv.startingTyre.padEnd(6)} final=${c.tyreCompound.padEnd(6)} stops=${row.tyreStops} pf=${drv.paceFactor.toFixed(4)} best=${row.bestLapTime?.toFixed(2) ?? "-"} rt=${row.raceTime.toFixed(1)}`);
    }
  }
}
console.log(`\nAVG: P1→P20 spread ${(sumSpread / count).toFixed(1)}s | median neighbor gap ${(sumNeighborAvg / count).toFixed(2)}s`);
console.log("(realistic target: neighbor ~0.3-1.0s, P1→P20 ~25-60s for 12 laps)");
