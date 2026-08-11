import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile, RaceResult } from "@f1race/race-engine";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import type { DriverProfile } from "../src/persistence/repository.js";
import { Room, type RoomSink } from "../src/room.js";
import type { ServerMessage } from "../src/protocol.js";

const HERO: PilotProfile = {
  name: "Streak Hero",
  country: "AT",
  team: "Redline",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

function makeSink(): RoomSink & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return { messages, send: (m) => messages.push(m), isOpen: () => true };
}

function fakeResult(driverId: string, place = 1, gridPosition = 1): RaceResult {
  return {
    rows: [
      {
        driverId,
        place,
        raceTime: 1200,
        bestLapTime: 90,
        gapToLeader: 0,
        tyreStops: 1,
        fastestLap: true,
        positionsGained: Math.max(0, gridPosition - place),
        gridPosition,
        dnf: false,
      },
    ],
    fastestLapDriverId: driverId,
    events: [],
  };
}

function dayNow(): number {
  return Math.floor(Date.now() / 86_400_000);
}

describe("S2-10: daily-streak bonus in applyProgression", () => {
  let dir: string;
  let repo: DriverProfileRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-streak-"));
    repo = createRepository(join(dir, "streak.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("first race starts a fresh streak (streakDays=1, no multiplier)", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO, "streak-first");
    const before = repo.get("streak-first")!;
    expect(before.streakDays ?? 0).toBe(0);

    room.applyProgressForTest(fakeResult(driverId));

    const prog = sink.messages.find((m) => m.type === "progression") as
      | { type: "progression"; xpGained: number; streakDays?: number }
      | undefined;
    expect(prog).toBeDefined();
    expect(prog!.streakDays).toBe(1);

    const stored = repo.get("streak-first")!;
    expect(stored.streakDays).toBe(1);
    expect(stored.lastRaceDay).toBe(dayNow());
    // multiplier = 1 + 0.10 * (1 - 1) = 1.0 → xpGained matches base xp for a P1 pole.
    expect(prog!.xpGained).toBeGreaterThan(0);
  });

  it("a second race on the SAME day does not extend the streak (no extra multiplier)", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO, "streak-sameday");
    // Simulate a race already done earlier today with streakDays=1.
    const seeded = repo.get("streak-sameday")!;
    seeded.lastRaceDay = dayNow();
    seeded.streakDays = 1;
    seeded.totalXp = 200;
    repo.upsert(seeded);
    // The room caches the resolved profile at addConnection; mirror the change there too.
    (room as unknown as { connections: Map<string, { savedProfile: DriverProfile | null }> })
      .connections.get("conn-a")!.savedProfile = repo.get("streak-sameday");

    room.applyProgressForTest(fakeResult(driverId));

    const prog = sink.messages.find((m) => m.type === "progression") as
      | { type: "progression"; streakDays?: number }
      | undefined;
    expect(prog!.streakDays).toBe(1);
    const stored = repo.get("streak-sameday")!;
    expect(stored.streakDays).toBe(1);
    expect(stored.lastRaceDay).toBe(dayNow());
  });

  it("a race on the next day extends the streak and applies the +10% multiplier", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO, "streak-day2");
    const seeded = repo.get("streak-day2")!;
    seeded.lastRaceDay = dayNow() - 1; // yesterday
    seeded.streakDays = 1;
    seeded.totalXp = 200;
    repo.upsert(seeded);
    (room as unknown as { connections: Map<string, { savedProfile: DriverProfile | null }> })
      .connections.get("conn-a")!.savedProfile = repo.get("streak-day2");

    room.applyProgressForTest(fakeResult(driverId));

    const prog = sink.messages.find((m) => m.type === "progression") as
      | { type: "progression"; xpGained: number; streakDays?: number }
      | undefined;
    expect(prog!.streakDays).toBe(2);
    // multiplier = 1 + 0.10 * (2 - 1) = 1.10. Re-derive the base from a fresh 1-streak race.
    const baselineRoom = new Room(repo);
    const baselineSink = makeSink();
    const baselineDriver = baselineRoom.addConnection("conn-b", baselineSink, HERO, "streak-baseline");
    baselineRoom.applyProgressForTest(fakeResult(baselineDriver));
    const baseline = baselineSink.messages.find((m) => m.type === "progression") as
      | { type: "progression"; xpGained: number }
      | undefined;
    expect(baseline).toBeDefined();
    expect(prog!.xpGained).toBe(Math.round(baseline!.xpGained * 1.1));
  });

  it("a gap of more than one day resets the streak to 1", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO, "streak-gap");
    // Three-day-old last race with a long streak — should reset to 1.
    const seeded = repo.get("streak-gap")!;
    seeded.lastRaceDay = dayNow() - 3;
    seeded.streakDays = 5;
    seeded.totalXp = 200;
    repo.upsert(seeded);
    (room as unknown as { connections: Map<string, { savedProfile: DriverProfile | null }> })
      .connections.get("conn-a")!.savedProfile = repo.get("streak-gap");

    room.applyProgressForTest(fakeResult(driverId));

    const prog = sink.messages.find((m) => m.type === "progression") as
      | { type: "progression"; streakDays?: number }
      | undefined;
    expect(prog!.streakDays).toBe(1);
    const stored = repo.get("streak-gap")!;
    expect(stored.streakDays).toBe(1);
    expect(stored.lastRaceDay).toBe(dayNow());
  });

  it("the streak caps at 7 days (no further multiplier growth)", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO, "streak-cap");
    const seeded = repo.get("streak-cap")!;
    seeded.lastRaceDay = dayNow() - 1;
    seeded.streakDays = 7;
    seeded.totalXp = 200;
    repo.upsert(seeded);
    (room as unknown as { connections: Map<string, { savedProfile: DriverProfile | null }> })
      .connections.get("conn-a")!.savedProfile = repo.get("streak-cap");

    room.applyProgressForTest(fakeResult(driverId));

    const prog = sink.messages.find((m) => m.type === "progression") as
      | { type: "progression"; xpGained: number; streakDays?: number }
      | undefined;
    // Already at the cap; another consecutive day stays at 7.
    expect(prog!.streakDays).toBe(7);

    // multiplier = 1 + 0.10 * (7 - 1) = 1.60 (+60%).
    const baselineRoom = new Room(repo);
    const baselineSink = makeSink();
    const baselineDriver = baselineRoom.addConnection("conn-c", baselineSink, HERO, "streak-cap-base");
    baselineRoom.applyProgressForTest(fakeResult(baselineDriver));
    const baseline = baselineSink.messages.find((m) => m.type === "progression") as
      | { type: "progression"; xpGained: number }
      | undefined;
    expect(prog!.xpGained).toBe(Math.round(baseline!.xpGained * 1.6));
  });
});
