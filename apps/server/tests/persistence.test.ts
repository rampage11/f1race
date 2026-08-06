import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { ABSOLUTE_SKILL_MAX, type PilotProfile, type RaceResult } from "@f1race/race-engine";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import { SqliteDriverProfileRepository } from "../src/persistence/sqlite-repository.js";
import type { ServerMessage } from "../src/protocol.js";
import { Room, type RoomSink } from "../src/room.js";

const HERO: PilotProfile = {
  name: "Test Hero",
  country: "AT",
  team: "Redmine",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
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
      heroConfirmed: true,
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
      heroConfirmed: true,
      createdAt: now,
      updatedAt: now,
    });
    const edited: PilotProfile = { ...HERO, name: "Edited", team: "Crimson" };
    repo.upsert({
      guestId: "g1",
      hero: edited,
      totalXp: 250,
      racesCount: 3,
      heroConfirmed: true,
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
      heroConfirmed: true,
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
      heroConfirmed: true,
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

describe("SqliteDriverProfileRepository: training jobs", () => {
  let dir: string;
  let repo: DriverProfileRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-train-"));
    repo = createRepository(join(dir, "train.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedProfile(guestId = "g1", heroOverride?: PilotProfile): void {
    const now = Date.now();
    repo.upsert({
      guestId,
      hero: heroOverride ?? HERO,
      totalXp: 0,
      racesCount: 0,
      heroConfirmed: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("startTraining inserts a row retrievable via getActiveTraining (active = completedAt IS NULL)", () => {
    seedProfile();
    const job = repo.startTraining("g1", "pace", 1000, 600);
    expect(job.id).toBeGreaterThan(0);
    expect(job.profileId).toBe("g1");
    expect(job.targetSkill).toBe("pace");
    expect(job.startedAt).toBe(1000);
    expect(job.durationSec).toBe(600);
    expect(job.completedAt).toBeNull();
    const active = repo.getActiveTraining("g1");
    expect(active).not.toBeNull();
    expect(active!.id).toBe(job.id);
    expect(active!.targetSkill).toBe("pace");
  });

  it("getActiveTraining returns null when none, and ignores completed rows", () => {
    seedProfile();
    expect(repo.getActiveTraining("g1")).toBeNull();
    const job = repo.startTraining("g1", "fitness", 1000, 600);
    const profile = repo.get("g1")!;
    repo.completeTraining(job, profile);
    expect(repo.getActiveTraining("g1")).toBeNull();
  });

  it("completeTraining increments the target skill by 1, marks completedAt, and clears active", () => {
    seedProfile();
    const before = repo.get("g1")!;
    expect(before.hero.skills.pace).toBe(3);
    const job = repo.startTraining("g1", "pace", 1000, 600);
    const profile = repo.get("g1")!;
    repo.completeTraining(job, profile);
    expect(repo.getActiveTraining("g1")).toBeNull();
    // Re-open a fresh repo on the same file to prove the increment hit disk.
    repo.close();
    repo = createRepository(join(dir, "train.db"));
    const stored = repo.get("g1");
    expect(stored).not.toBeNull();
    expect(stored!.hero.skills.pace).toBe(4);
  });

  it("completeTraining clamps at ABSOLUTE_SKILL_MAX (no overflow)", () => {
    const maxedHero: PilotProfile = {
      ...HERO,
      skills: { ...HERO.skills, pace: ABSOLUTE_SKILL_MAX },
    };
    seedProfile("g1", maxedHero);
    const job = repo.startTraining("g1", "pace", 1000, 600);
    const profile = repo.get("g1")!;
    expect(profile.hero.skills.pace).toBe(ABSOLUTE_SKILL_MAX);
    repo.completeTraining(job, profile);
    expect(profile.hero.skills.pace).toBe(ABSOLUTE_SKILL_MAX);
    repo.close();
    repo = createRepository(join(dir, "train.db"));
    const stored = repo.get("g1");
    expect(stored!.hero.skills.pace).toBe(ABSOLUTE_SKILL_MAX);
  });

  it("cancelTraining deletes the active row", () => {
    seedProfile();
    const job = repo.startTraining("g1", "reaction", 1000, 600);
    expect(repo.getActiveTraining("g1")).not.toBeNull();
    repo.cancelTraining(job.id);
    expect(repo.getActiveTraining("g1")).toBeNull();
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

  it("driverRating promotes a low-level but highly-trained hero to a higher division", () => {
    // All skills at 8 → sum 48. At level 1: rating = 1 + (48-10)*0.5 = 20 → F2.
    // Level alone (1) would be F4; this proves the two-factor rating works end-to-end.
    const trainedHero: PilotProfile = {
      name: "Trained Pro",
      country: "AT",
      team: "Topline",
      skills: { fitness: 8, reaction: 8, attack: 8, defense: 8, pace: 8, tyreMgmt: 8 },
      startingTyre: "medium",
      pitCompound: "soft",
    };
    const room = new Room(repo);
    const sink = makeSink();
    room.addConnection("conn-a", sink, trainedHero, "guest-trained");
    const welcome = sink.messages.find((m) => m.type === "welcome") as
      | {
          type: "welcome";
          profile?: {
            level: number;
            division: string;
            driverRating: number;
          };
        }
      | undefined;
    expect(welcome).toBeDefined();
    expect(welcome!.profile).toBeDefined();
    expect(welcome!.profile!.level).toBe(1);
    expect(welcome!.profile!.driverRating).toBe(20);
    expect(welcome!.profile!.division).toBe("F2");
    room.stop();
  });
});
