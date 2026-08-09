import { describe, expect, it } from "vitest";
import type { PilotProfile } from "@f1race/race-engine";
import { SqliteDriverProfileRepository } from "../src/persistence/sqlite-repository.js";
import type { DriverProfile } from "../src/persistence/repository.js";
import { TutorialRoom, type TutorialSink } from "../src/tutorial-room.js";
import type { ServerMessage } from "../src/protocol.js";

const HERO: PilotProfile = {
  name: "Tutor",
  country: "RU",
  team: "McLaren",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

function makeSink(): TutorialSink & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return {
    messages,
    send: (m) => messages.push(m),
    isOpen: () => true,
  };
}

function repo(): SqliteDriverProfileRepository {
  return new SqliteDriverProfileRepository(":memory:");
}

function profile(repo: SqliteDriverProfileRepository, totalXp = 0): DriverProfile {
  const now = Date.now();
  const p: DriverProfile = {
    guestId: "tut-1",
    hero: HERO,
    totalXp,
    racesCount: 0,
    heroConfirmed: true,
    tutorialCompleted: false,
    createdAt: now,
    updatedAt: now,
  };
  repo.upsert(p);
  return repo.get("tut-1")!;
}

describe("TutorialRoom", () => {
  it("streams the step sequence in order and marks the profile complete with the XP bonus", () => {
    const r = repo();
    const p = profile(r, 0);
    const sink = makeSink();
    const room = new TutorialRoom(sink, HERO, r, p);
    room.__runForTest();

    const steps = sink.messages
      .filter((m) => m.type === "tutorialStep")
      .map((m) => (m as { step: string }).step);
    expect(steps).toEqual(["welcome", "pit_hint", "hammer_hint", "finish"]);

    const stored = r.get("tut-1")!;
    expect(stored.tutorialCompleted).toBe(true);
    expect(stored.totalXp).toBe(30);

    expect(sink.messages.some((m) => m.type === "result")).toBe(true);
    const prog = sink.messages.find((m) => m.type === "progression") as
      | { xpGained: number; totalXp: number }
      | undefined;
    expect(prog).toBeDefined();
    expect(prog!.xpGained).toBe(30);
    expect(prog!.totalXp).toBe(30);
  });

  it("forwards pit + hammer requests to the engine without throwing", () => {
    const r = repo();
    const p = profile(r, 0);
    const sink = makeSink();
    const room = new TutorialRoom(sink, HERO, r, p);
    // Hero starts on medium → a soft pit request is valid.
    expect(() => room.handleMessage({ type: "pit", compound: "soft" })).not.toThrow();
    expect(() => room.handleMessage({ type: "hammerTime", mode: "attack" })).not.toThrow();
    room.stop();
  });
});
