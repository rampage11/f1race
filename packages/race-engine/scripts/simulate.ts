import {
  RaceEngine,
  buildRaceConfig,
  makeBot,
  makeDriver,
  redBullRing,
  runQualifying,
  baseLapTime,
  emptySkills,
  mulberry32,
  type Driver,
} from "../src/index.js";

const argv = process.argv.slice(2);
const gridMode = argv.includes("--grid");
const seedArg = argv.find((a) => a.startsWith("--seed="));
const seed = seedArg ? Number(seedArg.split("=")[1]) : 42;

function hero(name: string, skillsOverride?: Partial<ReturnType<typeof emptySkills>>) {
  const skills = { ...emptySkills(), fitness: 2, reaction: 2, attack: 2, defense: 1, pace: 2, tyreMgmt: 1, ...skillsOverride };
  return makeDriver({
    name,
    country: "RU",
    kind: "human",
    team: "Academy",
    skills,
    startingTyre: "medium",
    pitPlan: { targetStops: 1, strategy: "flexible", compound: "soft" },
    reactionTimeSec: 0.18,
  });
}

function buildField(seed: number, heroDriver: Driver): Driver[] {
  const rng = mulberry32(seed);
  const bots: Driver[] = [];
  for (let i = 0; i < 19; i++) bots.push(makeBot({}, rng));
  return [heroDriver, ...bots];
}

function formatTime(t: number | null): string {
  if (t == null || !Number.isFinite(t)) return "—";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function runOne(label: string, heroDriver: Driver, seed: number) {
  const track = redBullRing();
  const t0 = baseLapTime(track);
  const field = buildField(seed, heroDriver);
  const qrng = mulberry32(seed * 7 + 1);
  const quali = runQualifying(field, t0, qrng);
  const grid = quali
    .map((q) => ({ driver: field.find((d) => d.id === q.driverId)!, q }))
    .sort((a, b) => a.q.gridPosition - b.q.gridPosition)
    .map((x) => x.driver);

  const cfg = buildRaceConfig({ track, drivers: grid, totalLaps: 20, seed: seed * 13 + 5, dt: 0.1 });
  const engine = new RaceEngine(cfg);
  const result = engine.run();

  console.log(`\n=== ${label} (seed=${seed}) | ${track.name} | ${cfg.totalLaps} laps | t0=${t0.toFixed(2)}s ===`);
  console.log("Grid (quali):");
  for (const q of quali.slice(0, 5)) {
    const d = field.find((x) => x.id === q.driverId)!;
    console.log(`  P${q.gridPosition} ${d.name.padEnd(22)} ${q.lapTime.toFixed(3)}s`);
  }

  console.log("\nRace result:");
  const rows = result.rows.map((r) => {
    const d = field.find((x) => x.id === r.driverId)!;
    return {
      P: r.place,
      Driver: d.name,
      Team: d.team,
      Grid: r.gridPosition,
      "+/-": r.positionsGained > 0 ? `+${r.positionsGained}` : `${r.positionsGained}`,
      Time: formatTime(r.raceTime),
      Gap: `+${r.gapToLeader.toFixed(1)}s`,
      Stops: r.tyreStops,
      Best: r.bestLapTime ? `${r.bestLapTime.toFixed(3)}${r.fastestLap ? "*" : ""}` : "—",
      Kind: d.kind,
    };
  });
  console.table(rows);

  const heroEvents = result.events.filter(
    (e) =>
      (e.type === "overtake" && (e.attackerId === heroDriver.id || e.victimId === heroDriver.id)) ||
      (e.type === "pit_stop" && e.driverId === heroDriver.id) ||
      (e.type === "false_start" && e.driverId === heroDriver.id),
  );
  const heroRow = result.rows.find((r) => r.driverId === heroDriver.id)!;
  console.log(`Hero ${heroDriver.name}: finished P${heroRow.place} (from P${heroRow.gridPosition}), ` +
    `${heroEvents.filter((e) => e.type === "overtake" && e.attackerId === heroDriver.id).length} overtakes for, ` +
    `${heroEvents.filter((e) => e.type === "overtake" && e.victimId === heroDriver.id).length} against, ` +
    `${heroEvents.filter((e) => e.type === "pit_stop").length} stops.`);
  const overtakes = result.events.filter((e) => e.type === "overtake").length;
  const pits = result.events.filter((e) => e.type === "pit_stop").length;
  console.log(`Total overtakes: ${overtakes}, total pit stops: ${pits}, fastest lap: ${result.fastestLapDriverId ?? "—"}`);
}

function main() {
  if (gridMode) {
    const setups: Array<{ label: string; skills: Partial<ReturnType<typeof emptySkills>> }> = [
      { label: "Balanced", skills: {} },
      { label: "Pace-heavy (квал лидер)", skills: { pace: 5, attack: 0, defense: 0, fitness: 1, reaction: 1, tyreMgmt: 1 } },
      { label: "Attacker (много обгонов)", skills: { pace: 1, attack: 5, defense: 0, fitness: 1, reaction: 1, tyreMgmt: 1 } },
      { label: "Defender + Tyre saver", skills: { pace: 1, attack: 0, defense: 4, fitness: 1, reaction: 1, tyreMgmt: 3 } },
    ];
    for (const s of setups) runOne(s.label, hero(s.label, s.skills), seed);
  } else {
    runOne("Default hero", hero("Mika Räikkönen"), seed);
  }
}

main();
