import {
  RaceEngine,
  baseLapTime,
  buildRaceConfig,
  emptySkills,
  makeBot,
  makeDriver,
  mulberry32,
  redBullRing,
  runQualifying,
  estimateTyreLifespanLaps,
  type Driver,
  type Skills,
  type TyreCompound,
} from "../src/index.js";

function buildField(seed: number, hero: Driver): Driver[] {
  const rng = mulberry32(seed);
  const bots: Driver[] = [];
  for (let i = 0; i < 19; i++) bots.push(makeBot({}, rng));
  return [hero, ...bots];
}

function gridOf(field: Driver[], seed: number): Driver[] {
  const t0 = baseLapTime(redBullRing());
  const q = runQualifying(field, t0, mulberry32(seed * 7 + 1));
  return q
    .map((r) => field.find((d) => d.id === r.driverId)!)
    .sort((a, b) => q.find((x) => x.driverId === a.id)!.gridPosition - q.find((x) => x.driverId === b.id)!.gridPosition);
}

function heroBuild(name: string, skills: Skills, tyre: TyreCompound, pit: TyreCompound): Driver {
  return makeDriver({
    name,
    country: "RU",
    kind: "human",
    team: "Academy",
    skills,
    startingTyre: tyre,
    pitPlan: { targetStops: 1, strategy: "flexible", compound: pit },
    reactionTimeSec: 0.2,
  });
}

function run(build: { label: string; skills: Skills; tyre: TyreCompound; pit: TyreCompound }, seeds: number[]) {
  const places: number[] = [];
  let gridAvg = 0;
  let pitStopsTotal = 0;
  let bestLapSum = 0;
  let leaderBestLapSum = 0;
  let raceTimeSum = 0;
  for (const seed of seeds) {
    const hero = heroBuild(build.label, build.skills, build.tyre, build.pit);
    const field = buildField(seed, hero);
    const grid = gridOf(field, seed);
    const cfg = buildRaceConfig({ track: redBullRing(), drivers: grid, totalLaps: 12, seed: seed * 13 + 5, dt: 0.1, heroId: hero.id });
    const result = new RaceEngine(cfg).run();
    const row = result.rows.find((r) => r.driverId === hero.id)!;
    places.push(row.place);
    gridAvg += row.gridPosition;
    pitStopsTotal += row.tyreStops;
    if (row.bestLapTime) bestLapSum += row.bestLapTime;
    const leader = result.rows[0]!;
    leaderBestLapSum += leader.bestLapTime ?? 0;
    raceTimeSum += row.raceTime;
  }
  const avg = (places.reduce((a, b) => a + b, 0) / places.length).toFixed(1);
  const best = Math.min(...places);
  const worst = Math.max(...places);
  const bl = (bestLapSum / seeds.length).toFixed(2);
  const lbl = (leaderBestLapSum / seeds.length).toFixed(2);
  console.log(`${build.label.padEnd(26)} ${build.tyre.padEnd(6)}→${build.pit.padEnd(6)} | avg P${avg} (best P${best}, worst P${worst}, grid P${(gridAvg / seeds.length).toFixed(1)}) | hero best ${bl}s vs leader ${lbl}s | race ${(raceTimeSum / seeds.length / 60).toFixed(1)}min`);
}

const seeds = [1, 2, 3, 4, 5];
console.log(`\n=== Balance check: 12 laps, ${seeds.length} seeds ===`);
const track = redBullRing();
const lapKm = track.lengthM / 1000;
console.log(`Lap length: ${lapKm.toFixed(2)} km, base lap ~${baseLapTime(track).toFixed(1)}s, pit delta ${track.pitLaneDelta}s`);
console.log(`Tyre lifespan (tyreMgmt=0): soft ~${estimateTyreLifespanLaps("soft", 0, lapKm)}, medium ~${estimateTyreLifespanLaps("medium", 0, lapKm)}, hard ~${estimateTyreLifespanLaps("hard", 0, lapKm)} laps`);
console.log("");

run({ label: "pace+attack MAX (user)", skills: { ...emptySkills(), pace: 5, attack: 5 }, tyre: "soft", pit: "soft" }, seeds);
run({ label: "pace+attack MAX → pit med", skills: { ...emptySkills(), pace: 5, attack: 5 }, tyre: "soft", pit: "medium" }, seeds);
run({ label: "balanced", skills: { ...emptySkills(), pace: 2, attack: 2, defense: 2, fitness: 2, reaction: 1, tyreMgmt: 1 }, tyre: "medium", pit: "soft" }, seeds);
run({ label: "tyre strategist", skills: { ...emptySkills(), pace: 2, attack: 1, defense: 2, fitness: 1, reaction: 1, tyreMgmt: 3 }, tyre: "medium", pit: "soft" }, seeds);
run({ label: "defense turtle", skills: { ...emptySkills(), pace: 2, attack: 1, defense: 4, fitness: 1, reaction: 1, tyreMgmt: 1 }, tyre: "hard", pit: "medium" }, seeds);
