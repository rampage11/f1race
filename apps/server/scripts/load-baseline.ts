import { Room, type RoomSink } from "../src/room.js";
import type { PilotProfile, ServerMessage } from "../src/protocol.js";
import type { Stage } from "../src/protocol.js";

const FIELD_SIZE = 20;
const WARMUP_TICKS = 50;
const MEASURE_TICKS_QUALY = 600;
const RACE_PREADVANCE_MAX = 4500;
const MEASURE_TICKS_RACE = 400;

interface Sample {
  rooms: number;
  connsPerRoom: number;
  qualyTickMs: number;
  raceTickMs: number;
  rssMb: number;
  raceRoomCoverage: number;
  maxAdvance: number;
}

function makeHeroProfile(i: number): PilotProfile {
  return {
    name: `Hero${i}`,
    country: "AT",
    team: "Redmine",
    skills: { fitness: 5, reaction: 5, attack: 5, defense: 5, pace: 5, tyreMgmt: 5 },
    startingTyre: "medium",
    pitCompound: "soft",
  };
}

function makeSerializingSink(): RoomSink {
  return {
    send: (m: ServerMessage) => {
      void JSON.stringify(m);
    },
    isOpen: () => true,
  };
}

function buildRoom(connsPerRoom: number): Room {
  const room = new Room();
  for (let i = 0; i < connsPerRoom; i++) {
    room.addConnection(`c${i}`, makeSerializingSink(), makeHeroProfile(i));
  }
  room.stop();
  return room;
}

function countStage(rooms: Room[], stage: Stage): number {
  let n = 0;
  for (const r of rooms) if (r.currentStage === stage) n++;
  return n;
}

function measureTicks(rooms: Room[], frames: number): number {
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    for (const room of rooms) room.tick();
  }
  return performance.now() - t0;
}

function runCase(rooms: number, connsPerRoom: number): Sample {
  const list: Room[] = [];
  for (let i = 0; i < rooms; i++) list.push(buildRoom(connsPerRoom));

  for (const room of list) for (let t = 0; t < WARMUP_TICKS; t++) room.tick();
  const qualyWallMs = measureTicks(list, MEASURE_TICKS_QUALY);
  const qualyPerTickMs = qualyWallMs / (MEASURE_TICKS_QUALY * rooms);

  // advance each room until it has reached the (heavier) race stage
  let maxAdvance = 0;
  for (const room of list) {
    let t = 0;
    while (room.currentStage !== "race" && t < RACE_PREADVANCE_MAX) {
      room.tick();
      t++;
    }
    if (t > maxAdvance) maxAdvance = t;
  }
  const inRace = countStage(list, "race");
  const raceWallMs = measureTicks(list, MEASURE_TICKS_RACE);
  const racePerTickMs = raceWallMs / (MEASURE_TICKS_RACE * rooms);

  for (const room of list) room.stop();
  const rssAfter = process.memoryUsage().rss;

  if (globalThis.gc) globalThis.gc();

  return {
    rooms,
    connsPerRoom,
    qualyTickMs: Number(qualyPerTickMs.toFixed(4)),
    raceTickMs: Number(racePerTickMs.toFixed(4)),
    rssMb: Number((rssAfter / 1024 / 1024).toFixed(1)),
    raceRoomCoverage: inRace,
    maxAdvance,
  };
}

function printTable(rows: Sample[]): void {
  const header = ["rooms", "conns", "qualy ms/tick", "race ms/tick", "rss MB", "rooms in race"];
  const fmt = (s: Sample): string[] => [
    String(s.rooms),
    String(s.connsPerRoom),
    s.qualyTickMs.toFixed(4),
    s.raceTickMs.toFixed(4),
    s.rssMb.toFixed(1),
    `${s.raceRoomCoverage}/${s.rooms}`,
  ];
  const all = [header, ...rows.map(fmt)];
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  for (const r of all) {
    console.log("  " + r.map((c, i) => c.padEnd(widths[i]!)).join("  "));
  }
}

async function main(): Promise<void> {
  console.log("# load-baseline (Room model, Phase 1)");
  console.log(`# field size ${FIELD_SIZE} cars/room; M=2 live connections (multiplayer mode, 1 sim-step/tick);`);
  console.log(`# warmup ${WARMUP_TICKS} ticks; qualy window ${MEASURE_TICKS_QUALY} ticks; race pre-advance (adaptive, max ${RACE_PREADVANCE_MAX} ticks), measured ${MEASURE_TICKS_RACE} ticks.`);
  console.log(`# sinks JSON.stringify each broadcast (approx wire serialization).`);
  console.log(`# node ${process.version}, rss at start ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`);
  console.log("");

  const roomCounts = [1, 10, 50, 100];
  const rows: Sample[] = [];

  // throwaway warmup so the first measured case isn't penalised by V8 JIT cold-start
  const warmup = buildRoom(2);
  while (warmup.currentStage !== "race") warmup.tick();
  for (let t = 0; t < MEASURE_TICKS_RACE; t++) warmup.tick();
  warmup.stop();
  if (globalThis.gc) globalThis.gc();

  for (const n of roomCounts) {
    const sample = runCase(n, 2);
    rows.push(sample);
    console.log(`  done: ${n} room(s) — race ms/tick ${sample.raceTickMs}, rss ${sample.rssMb} MB`);
  }

  console.log("");
  printTable(rows);

  console.log("");
  console.log("## budget check (10Hz tick = 100ms wall budget per frame):");
  for (const s of rows) {
    const frameMs = s.raceTickMs * s.rooms;
    const headroom = 100 - frameMs;
    console.log(
      `  N=${String(s.rooms).padStart(3)}: frame=${frameMs.toFixed(2)}ms  ${headroom >= 0 ? "OK" : "OVER BUDGET"} (${headroom >= 0 ? "+" : ""}${headroom.toFixed(1)}ms headroom)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
