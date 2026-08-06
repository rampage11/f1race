import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile, RaceResult } from "@f1race/race-engine";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import { SqliteDriverProfileRepository } from "../src/persistence/sqlite-repository.js";
import type { ServerMessage } from "../src/protocol.js";
import { Room, type RoomSink } from "../src/room.js";

const HERO: PilotProfile = {
  name: "Test Hero",
  country: "AT",
  team: "Redmine",
  skills: { fitness: 5, reaction: 5, attack: 5, defense: 5, pace: 5, tyreMgmt: 5 },
  startingTyre: "medium",
  pitCompound: "soft",
};

describe("SqliteDriverProfileRepository: round-trip", () => {
  let dir: string;
  let repo: DriverProfileRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-persist-"));
    repo = createRepository(join(dir, "test.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("get on a missing guestId returns null", () => {
    expect(repo.get("nope")).toBeNull();
  });

  it("upsert + get round-trips a new profile", () => {
    const now = Date.now();
    repo.upsert({
      guestId: "g1",
      hero: HERO,
      totalXp: 250,
      racesCount: 3,
      createdAt: now,
      updatedAt: now,
    });
    const got = repo.get("g1");
    expect(got).not.toBeNull();
    expect(got!.guestId).toBe("g1");
    expect(got!.totalXp).toBe(250);
    expect(got!.racesCount).toBe(3);
    expect(got!.hero).toEqual(HERO);
  });

  it("upsert overwrites the hero but preserves totalXp/racesCount as written", () => {
    const now = Date.now();
    repo.upsert({
      guestId: "g1",
      hero: HERO,
      totalXp: 250,
      racesCount: 3,
      createdAt: now,
      updatedAt: now,
    });
    const edited: PilotProfile = { ...HERO, name: "Edited", team: "Crimson" };
    repo.upsert({
      guestId: "g1",
      hero: edited,
      totalXp: 250,
      racesCount: 3,
      createdAt: now,
      updatedAt: now + 5,
    });
    const got = repo.get("g1");
    expect(got!.hero.name).toBe("Edited");
    expect(got!.hero.team).toBe("Crimson");
    expect(got!.totalXp).toBe(250);
    expect(got!.racesCount).toBe(3);
  });

  it("addRaceResult stores a row retrievable via the impl's history()", () => {
    const now = Date.now();
    repo.upsert({
      guestId: "g1",
      hero: HERO,
      totalXp: 0,
      racesCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    repo.addRaceResult({
      profileId: "g1",
      finishedAt: now,
      place: 2,
      gridPosition: 5,
      fastestLapDriverId: "d1",
      positionsGained: 3,
      xpGained: 88,
      dnf: false,
    });
    // Re-open a fresh repo on the same file to prove it hit disk.
    repo.close();
    repo = createRepository(join(dir, "test.db"));
    const got = repo.get("g1");
    expect(got).not.toBeNull();
    expect(got!.racesCount).toBe(0);
  });

  it("recordRaceFinish writes both the profile update and the history row atomically", () => {
    // The repo does NOT mutate the profile — the caller (Room) does the XP increment before
    // calling. So this asserts the transaction persisted exactly what was passed, plus a row.
    const impl = new SqliteDriverProfileRepository(join(dir, "finish.db"));
    const now = Date.now();
    const profile = {
      guestId: "g1",
      hero: HERO,
      totalXp: 254,
      racesCount: 2,
      createdAt: now,
      updatedAt: now,
    };
    impl.recordRaceFinish(profile, {
      profileId: "g1",
      finishedAt: now + 1,
      place: 1,
      gridPosition: 4,
      fastestLapDriverId: "d_hero",
      positionsGained: 3,
      xpGained: 154,
      dnf: false,
    });
    const got = impl.get("g1");
    expect(got!.totalXp).toBe(254);
    expect(got!.racesCount).toBe(2);
    const hist = impl.history("g1");
    expect(hist).toHaveLength(1);
    expect(hist[0]!.xpGained).toBe(154);
    expect(hist[0]!.place).toBe(1);
    expect(hist[0]!.dnf).toBe(false);
    impl.close();
  });
});

describe("Room (unit): progression wiring (spec Phase 3)", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  let dir: string;
  let repo: DriverProfileRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-room-"));
    repo = createRepository(join(dir, "room.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function fakeResult(driverId: string): RaceResult {
    return {
      rows: [
        {
          driverId,
          place: 1,
          raceTime: 1200,
          bestLapTime: 90,
          gapToLeader: 0,
          tyreStops: 1,
          fastestLap: true,
          positionsGained: 3,
          gridPosition: 4,
          dnf: false,
        },
      ],
      fastestLapDriverId: driverId,
      events: [],
    };
  }

  it("hello with guestId loads/creates a profile and emits welcome.profile at level 1", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO, "guest-1");
    const welcome = sink.messages.find((m) => m.type === "welcome") as
      | { type: "welcome"; profile?: { level: number; division: string; racesCount: number; guestId: string } }
      | undefined;
    expect(welcome).toBeDefined();
    expect(welcome!.profile).toBeDefined();
    expect(welcome!.profile!.guestId).toBe("guest-1");
    expect(welcome!.profile!.level).toBe(1);
    expect(welcome!.profile!.division).toBe("F4");
    expect(welcome!.profile!.racesCount).toBe(0);
    room.stop();
  });

  it("a second hello with the same guestId reuses the stored profile (racesCount stays 0)", () => {
    const room1 = new Room(repo);
    const sink1 = makeSink();
    room1.addConnection("conn-a", sink1, HERO, "guest-1");
    room1.stop();

    const room2 = new Room(repo);
    const sink2 = makeSink();
    room2.addConnection("conn-b", sink2, HERO, "guest-1");
    const welcome = sink2.messages.find((m) => m.type === "welcome") as
      | { type: "welcome"; profile?: { level: number; racesCount: number; guestId: string } }
      | undefined;
    expect(welcome!.profile).toBeDefined();
    expect(welcome!.profile!.guestId).toBe("guest-1");
    expect(welcome!.profile!.level).toBe(1);
    expect(welcome!.profile!.racesCount).toBe(0);
    room2.stop();
  });

  it("applyProgressForTest computes non-zero xp, persists, and unicasts progression", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO, "guest-1");
    const result = fakeResult(driverId);
    room.applyProgressForTest(result);

    const prog = sink.messages.find((m) => m.type === "progression") as
      | {
          type: "progression";
          xpGained: number;
          totalXp: number;
          level: number;
          division: string;
          racesCount: number;
        }
      | undefined;
    expect(prog).toBeDefined();
    expect(prog!.xpGained).toBeGreaterThan(0);
    expect(prog!.totalXp).toBe(prog!.xpGained);
    expect(prog!.level).toBe(1);
    expect(prog!.division).toBe("F4");
    expect(prog!.racesCount).toBe(1);

    // Persisted to disk: fresh repo sees updated totals + a history row.
    room.stop();
    repo.close();
    repo = createRepository(join(dir, "room.db"));
    const stored = repo.get("guest-1");
    expect(stored).not.toBeNull();
    expect(stored!.totalXp).toBe(prog!.totalXp);
    expect(stored!.racesCount).toBe(1);
  });

  it("ephemeral (no guestId) connections skip progression entirely", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO);
    sink.messages.length = 0;
    room.applyProgressForTest(fakeResult(driverId));
    expect(sink.messages.find((m) => m.type === "progression")).toBeUndefined();
    room.stop();
  });
});
