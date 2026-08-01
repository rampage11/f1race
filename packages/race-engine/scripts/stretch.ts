import { RaceEngine, buildRaceConfig, emptySkills, makeBot, makeDriver, mulberry32, redBullRing, baseLapTime, runQualifying, type Driver } from "../src/index.js";

function field(seed: number): Driver[] {
  const rng = mulberry32(seed);
  const bots: Driver[] = [];
  for (let i = 0; i < 19; i++) bots.push(makeBot({}, rng));
  const hero = makeDriver({ name: "Hero", country: "RU", kind: "human", skills: { ...emptySkills(), pace: 3, attack: 2, defense: 2, fitness: 1, reaction: 1, tyreMgmt: 1 }, startingTyre: "medium", pitPlan: { targetStops: 1, strategy: "flexible", compound: "soft" } });
  return [hero, ...bots];
}
function gridOf(f: Driver[], seed: number): Driver[] {
  const track = redBullRing();
  const q = runQualifying(f, baseLapTime(track), mulberry32(seed * 7 + 1));
  return q.map((r) => f.find((d) => d.id === r.driverId)!).sort((a, b) => q.find((x) => x.driverId === a.id)!.gridPosition - q.find((x) => x.driverId === b.id)!.gridPosition);
}

const seed = 1;
const grid = gridOf(field(seed), seed);
const cfg = buildRaceConfig({ track: redBullRing(), drivers: grid, totalLaps: 12, seed: seed * 13 + 5, dt: 0.1 });
const eng = new RaceEngine(cfg);
const dt = 0.1;
const checkLaps = [0.5, 1, 2, 3, 5, 8, 12];
let nextIdx = 0;
const snapshots: { lap: number; spread: number; top10gap: number }[] = [];
while (eng.phase === "racing") {
  eng.step(dt);
  const snap = eng.snapshot();
  const leadLap = Math.max(...snap.cars.map((c) => c.lap)) + snap.cars[0]!.sFraction;
  const target = checkLaps[nextIdx];
  if (target !== undefined && leadLap >= target) {
    const dists = snap.cars.map((c) => c.lap + c.sFraction).sort((a, b) => b - a);
    const spread = (dists[0]! - dists[dists.length - 1]!) ;
    const top10gap = dists[0]! - dists[9]!;
    snapshots.push({ lap: target, spread, top10gap });
    console.log(`after ~lap ${target}: P1-P20 spread = ${(spread * 108).toFixed(1)}s, P1-P10 = ${(top10gap * 108).toFixed(1)}s`);
    nextIdx++;
  }
}
const result = eng.result();
const times = result.rows.map((r) => r.raceTime).sort((a, b) => a - b);
console.log(`\nfinal: P1=${times[0]!.toFixed(0)} P20=${times[19]!.toFixed(0)} spread=${(times[19]! - times[0]!).toFixed(1)}s`);
console.log(`(spread in seconds ≈ lapFraction × ~108s lap)`);
