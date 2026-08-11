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

function stepsOf(sink: { messages: ServerMessage[] }): string[] {
  return sink.messages
    .filter((m) => m.type === "tutorialStep")
    .map((m) => (m as { step: string }).step);
}

describe("TutorialRoom", () => {
  it("streams all steps (incl. strategy_intro) and awards +30 XP when the hero pits", () => {
    const r = repo();
    const p = profile(r, 0);
    const sink = makeSink();
    const room = new TutorialRoom(sink, HERO, r, p);
    // Queue a pit so the hero completes a stop and earns the finish bonus.
    room.handleMessage({ type: "pit", compound: "medium" });
    room.__runForTest();

    const steps = stepsOf(sink);
    // strategy_intro is emitted right after welcome; finish is last. The pit/hammer situations
    // fire in a deterministic order for the fixed seed but we only pin the bookends + set.
    expect(steps[0]).toBe("welcome");
    expect(steps[1]).toBe("strategy_intro");
    expect(steps[steps.length - 1]).toBe("finish");
    expect(new Set(steps)).toEqual(
      new Set(["welcome", "strategy_intro", "pit_hint", "hammer_hint", "finish"]),
    );

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

  it("awards 0 XP when the hero never pits (tutorial completes but no bonus)", () => {
    const r = repo();
    const p = profile(r, 0);
    const sink = makeSink();
    const room = new TutorialRoom(sink, HERO, r, p);
    room.__runForTest();

    const steps = stepsOf(sink);
    expect(new Set(steps)).toEqual(
      new Set(["welcome", "strategy_intro", "pit_hint", "hammer_hint", "finish"]),
    );

    const stored = r.get("tut-1")!;
    expect(stored.tutorialCompleted).toBe(true);
    expect(stored.totalXp).toBe(0);

    const prog = sink.messages.find((m) => m.type === "progression") as
      | { xpGained: number }
      | undefined;
    expect(prog).toBeDefined();
    expect(prog!.xpGained).toBe(0);
  });

  it("fires pit_hint via the tyre-wear trigger (>= 0.5) within the forced-wear race", () => {
    const r = repo();
    const p = profile(r, 0);
    const sink = makeSink();
    const room = new TutorialRoom(sink, HERO, r, p);
    room.__runForTest();
    // The pit hint must have fired (situation-based on wear, not a fixed lap).
    expect(stepsOf(sink)).toContain("pit_hint");
  });

  it("forwards pit + hammer requests to the engine without throwing", () => {
    const r = repo();
    const p = profile(r, 0);
    const sink = makeSink();
    const room = new TutorialRoom(sink, HERO, r, p);
    expect(() => room.handleMessage({ type: "pit", compound: "soft" })).not.toThrow();
    expect(() => room.handleMessage({ type: "hammerTime", mode: "attack" })).not.toThrow();
    room.stop();
  });
});
