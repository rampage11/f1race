import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile, RaceResult, CarSnapshot } from "@f1race/race-engine";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import { Room, type RoomSink } from "../src/room.js";
import type { ServerMessage } from "../src/protocol.js";

const HERO: PilotProfile = {
  name: "Push Hero",
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

function fakeResult(driverId: string, opts: { place?: number; gridPosition?: number; fieldSize?: number; dnf?: boolean; tyreStops?: number } = {}): RaceResult {
  const place = opts.place ?? 1;
  const fieldSize = opts.fieldSize ?? 20;
  const rows = [
    {
      driverId,
      place,
      raceTime: 1200,
      bestLapTime: 90,
      gapToLeader: 0,
      tyreStops: opts.tyreStops ?? 1,
      fastestLap: true,
      positionsGained: Math.max(0, (opts.gridPosition ?? 1) - place),
      gridPosition: opts.gridPosition ?? 1,
      dnf: opts.dnf ?? false,
    },
  ];
  // Pad with bot rows so gridSize reflects the field (affects currency: positionsAheadOfLast).
  for (let i = 2; i <= fieldSize; i++) {
    rows.push({
      driverId: `bot-${i}`,
      place: i === place ? place + 1 : i,
      raceTime: 1200 + i,
      bestLapTime: 95,
      gapToLeader: i,
      tyreStops: 1,
      fastestLap: false,
      positionsGained: 0,
      gridPosition: i,
      dnf: false,
    });
  }
  return { rows, fastestLapDriverId: driverId, events: [] };
}

function lastRaceSnapshot(sink: { messages: ServerMessage[] }): CarSnapshot[] | null {
  for (let i = sink.messages.length - 1; i >= 0; i--) {
    const m = sink.messages[i]!;
    if (m.type === "snapshot") {
      const snap = (m as { snapshot: { cars: CarSnapshot[] } }).snapshot;
      return snap.cars;
    }
  }
  return null;
}

describe("S3-4: soft currency on race finish", () => {
  let dir: string;
  let repo: DriverProfileRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-currency-"));
    repo = createRepository(join(dir, "currency.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("awards soft currency on a non-DNF finish (P1 in a 20-car field)", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-c", sink, HERO, "currency-p1");
    room.applyProgressForTest(fakeResult(driverId, { place: 1, fieldSize: 20 }));
    const stored = repo.get("currency-p1")!;
    // 10 + 5*(20-1) = 105, capped at 100.
    expect(stored.softCurrency).toBe(100);
  });

  it("awards less for a mid-field finish", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-c2", sink, HERO, "currency-p10");
    room.applyProgressForTest(fakeResult(driverId, { place: 10, gridPosition: 10, fieldSize: 20 }));
    const stored = repo.get("currency-p10")!;
    // 10 + 5*(20-10) = 60.
    expect(stored.softCurrency).toBe(60);
  });

  it("awards nothing on a DNF", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-c3", sink, HERO, "currency-dnf");
    room.applyProgressForTest(fakeResult(driverId, { place: 20, dnf: true }));
    const stored = repo.get("currency-dnf")!;
    expect(stored.softCurrency ?? 0).toBe(0);
  });
});

describe("S2-4: push-level handler", () => {
  let dir: string;
  let repo: DriverProfileRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-push-"));
    repo = createRepository(join(dir, "push.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a valid strategy and sets the hero car's pushStrategy", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-p", sink, HERO, "push-valid");
    room.__advanceForTest({ stopAtRace: true });
    expect(room.currentStage).toBe("race");

    const err = room.requestPushLevel("conn-p", "attack");
    expect(err).toBeNull();
    room.__emitSnapshotForTest();
    const cars = lastRaceSnapshot(sink)!;
    const hero = cars.find((c) => c.driverId === driverId)!;
    expect(hero.pushStrategy).toBe("attack");
  });

  it("rejects an invalid strategy", () => {
    const room = new Room(repo);
    const sink = makeSink();
    room.addConnection("conn-p2", sink, HERO, "push-invalid");
    room.__advanceForTest({ stopAtRace: true });
    const err = room.requestPushLevel("conn-p2", "conserve" as never);
    expect(err).toBe("invalid push strategy");
  });

  it("rejects outside the race stage", () => {
    const room = new Room(repo);
    const sink = makeSink();
    room.addConnection("conn-p3", sink, HERO, "push-noqualy");
    // Still in qualy (no __advanceForTest).
    const err = room.requestPushLevel("conn-p3", "balanced");
    expect(err).toBe("push level only available during the race");
  });

  it("rate-limits repeated setPushLevel (300ms)", () => {
    const room = new Room(repo);
    const sink = makeSink();
    room.addConnection("conn-p4", sink, HERO, "push-rate");
    room.__advanceForTest({ stopAtRace: true });
    expect(room.requestPushLevel("conn-p4", "attack")).toBeNull();
    // Immediate second call → rate-limited.
    expect(room.requestPushLevel("conn-p4", "balanced")).toBe("rate limit: setPushLevel");
  });

  it("re-applies the committed strategy after a pit stop (engine resets to balanced)", () => {
    const room = new Room(repo);
    const sink = makeSink();
    const driverId = room.addConnection("conn-p5", sink, HERO, "push-pit");
    room.__advanceForTest({ stopAtRace: true });

    // Commit to attack, then queue a pit (medium → hard for a compound change).
    expect(room.requestPushLevel("conn-p5", "attack")).toBeNull();
    room.__emitSnapshotForTest();
    const beforePit = lastRaceSnapshot(sink)!.find((c) => c.driverId === driverId)!;
    expect(beforePit.pushStrategy).toBe("attack");

    // Request a pit to a different compound.
    expect(room.requestPit("conn-p5", "hard")).toBeNull();

    // Step the race until the pit completes (hero leaves the pits) + the room re-applies.
    let reApplied = false;
    for (let i = 0; i < 50000 && !reApplied; i++) {
      room.__stepRaceForTest();
      if (room.currentStage !== "race") break;
      const hero = lastRaceSnapshot(sink)!.find((c) => c.driverId === driverId)!;
      // Once the hero is out of the pits with a fresh compound, the committed attack strategy
      // should have been re-applied by the pit-exit hook.
      if (!hero.inPits && hero.tyreCompound === "hard" && hero.pushStrategy === "attack") {
        reApplied = true;
      }
    }
    expect(reApplied).toBe(true);
  });
});
