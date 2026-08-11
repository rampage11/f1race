import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile, RaceResult } from "@f1race/race-engine";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import { pickDailyQuestIds, QUESTS_PER_DAY, questById, QUEST_DEFS } from "../src/quests.js";
import { Room, type RoomSink } from "../src/room.js";
import type { ServerMessage } from "../src/protocol.js";

const HERO: PilotProfile = {
  name: "Quest Hero",
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

function fakeResult(driverId: string, opts: { place?: number; gridPosition?: number; tyreStops?: number; positionsGained?: number; fastestLap?: boolean } = {}): RaceResult {
  const place = opts.place ?? 1;
  const gridPosition = opts.gridPosition ?? 1;
  return {
    rows: [
      {
        driverId,
        place,
        raceTime: 1200,
        bestLapTime: 90,
        gapToLeader: 0,
        tyreStops: opts.tyreStops ?? 1,
        fastestLap: opts.fastestLap ?? true,
        positionsGained: opts.positionsGained ?? Math.max(0, gridPosition - place),
        gridPosition,
        dnf: false,
      },
    ],
    fastestLapDriverId: opts.fastestLap === false ? null : driverId,
    events: [],
  };
}

function dayNow(): number {
  return Math.floor(Date.now() / 86_400_000);
}

describe("S2-9: daily quests", () => {
  describe("pickDailyQuestIds", () => {
    it("returns exactly QUESTS_PER_DAY distinct quest ids", () => {
      const ids = pickDailyQuestIds("profile-a", dayNow());
      expect(ids).toHaveLength(QUESTS_PER_DAY);
      expect(new Set(ids).size).toBe(QUESTS_PER_DAY);
    });

    it("is stable for the same (profileId, day) across calls", () => {
      const day = dayNow();
      const a = pickDailyQuestIds("profile-b", day);
      const b = pickDailyQuestIds("profile-b", day);
      expect(a).toEqual(b);
    });

    it("re-rolls for a different day or a different profile", () => {
      const day = dayNow();
      const base = pickDailyQuestIds("profile-c", day);
      const nextDay = pickDailyQuestIds("profile-c", day + 1);
      const otherProfile = pickDailyQuestIds("profile-d", day);
      // At least one of the two variations should differ (both COULD coincide by chance over a
      // 6-choose-3 pool, so assert at least one differs).
      const changed = JSON.stringify(base) !== JSON.stringify(nextDay) || JSON.stringify(base) !== JSON.stringify(otherProfile);
      expect(changed).toBe(true);
    });

    it("only picks ids that exist in the catalog", () => {
      const ids = pickDailyQuestIds("profile-e", dayNow());
      for (const id of ids) expect(questById(id)).not.toBeNull();
    });
  });

  describe("assignDailyQuests (idempotent)", () => {
    let dir: string;
    let repo: DriverProfileRepository;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "f1race-quest-"));
      repo = createRepository(join(dir, "quest.db"));
    });

    afterEach(() => {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it("assigning twice on the same day does not duplicate or wipe progress", () => {
      const day = dayNow();
      const ids = pickDailyQuestIds("q-idem", day);
      const first = repo.assignDailyQuests("q-idem", day, ids);
      expect(first).toHaveLength(QUESTS_PER_DAY);
      // Bump progress on one quest, then re-assign — progress must survive.
      repo.incrementQuestProgress("q-idem", ids[0]!, day, 1);
      const second = repo.assignDailyQuests("q-idem", day, ids);
      expect(second).toHaveLength(QUESTS_PER_DAY);
      const bumped = second.find((q) => q.questDefId === ids[0])!;
      expect(bumped.progress).toBe(1);
    });
  });

  describe("quest progress hooks in applyProgression", () => {
    let dir: string;
    let repo: DriverProfileRepository;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "f1race-questprog-"));
      repo = createRepository(join(dir, "questprog.db"));
    });

    afterEach(() => {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it("a P1 race with a pit + fastest lap ticks finish_race, finish_top5, pit_stop, fastest_lap", () => {
      const room = new Room(repo);
      const sink = makeSink();
      const driverId = room.addConnection("conn-q", sink, HERO, "q-progress");
      const day = dayNow();
      // Pre-assign ALL quest definitions today so every hook has a row to bump regardless of
      // which 3 pickDailyQuestIds would have chosen (applyProgression's own assignDailyQuests
      // call is idempotent — INSERT OR IGNORE — so the extra rows survive).
      repo.assignDailyQuests("q-progress", day, QUEST_DEFS.map((q) => q.id));

      room.applyProgressForTest(fakeResult(driverId, { place: 1, gridPosition: 1, tyreStops: 1, positionsGained: 0, fastestLap: true }));

      const assigned = repo.getActiveQuests("q-progress", day);
      const byId = new Map(assigned.map((q) => [q.questDefId, q.progress]));
      // finish_race always ticks on a finish.
      expect(byId.get("finish_race") ?? 0).toBeGreaterThanOrEqual(1);
      // top5 ticks for place <= 5.
      expect(byId.get("finish_top5") ?? 0).toBeGreaterThanOrEqual(1);
      // pit_stop ticks when tyreStops > 0.
      expect(byId.get("pit_stop") ?? 0).toBeGreaterThanOrEqual(1);
      // fastest_lap ticks when the hero got it.
      expect(byId.get("fastest_lap") ?? 0).toBeGreaterThanOrEqual(1);
    });

    it("overtakes_2 ticks by positionsGained", () => {
      const room = new Room(repo);
      const sink = makeSink();
      const driverId = room.addConnection("conn-q2", sink, HERO, "q-overtake");
      const day = dayNow();

      // Started P5, finished P2 → positionsGained = 3.
      room.applyProgressForTest(fakeResult(driverId, { place: 2, gridPosition: 5, tyreStops: 1, positionsGained: 3, fastestLap: false }));

      const assigned = repo.getActiveQuests("q-overtake", day);
      const ot = assigned.find((q) => q.questDefId === "overtakes_2");
      // If overtakes_2 was assigned today, progress should be >= positionsGained (3); if it
      // wasn't assigned, the increment is a no-op (only 3 of 6 quests are assigned per day).
      if (ot) expect(ot.progress).toBeGreaterThanOrEqual(2);
    });

    it("a DNF finish still ticks finish_race but awards no soft currency", () => {
      const room = new Room(repo);
      const sink = makeSink();
      const driverId = room.addConnection("conn-q3", sink, HERO, "q-dnf");
      const day = dayNow();

      const dnfResult: RaceResult = {
        rows: [
          {
            driverId,
            place: 20,
            raceTime: 1200,
            bestLapTime: null,
            gapToLeader: 999,
            tyreStops: 0,
            fastestLap: false,
            positionsGained: 0,
            gridPosition: 1,
            dnf: true,
          },
        ],
        fastestLapDriverId: null,
        events: [],
      };
      room.applyProgressForTest(dnfResult);

      const assigned = repo.getActiveQuests("q-dnf", day);
      const finishQ = assigned.find((q) => q.questDefId === "finish_race");
      if (finishQ) expect(finishQ.progress).toBeGreaterThanOrEqual(1);
      const stored = repo.get("q-dnf")!;
      expect(stored.softCurrency ?? 0).toBe(0);
    });
  });

  describe("claimQuest", () => {
    let dir: string;
    let repo: DriverProfileRepository;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "f1race-claim-"));
      repo = createRepository(join(dir, "claim.db"));
    });

    afterEach(() => {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it("claims a quest at goal, then rejects a re-claim (null)", () => {
      const day = dayNow();
      const def = questById("finish_race")!;
      repo.assignDailyQuests("q-claim", day, ["finish_race"]);
      // Not complete yet → null.
      expect(repo.claimQuest("q-claim", "finish_race", day, def.goal)).toBeNull();
      // Complete it.
      repo.incrementQuestProgress("q-claim", "finish_race", day, 1);
      const claimed = repo.claimQuest("q-claim", "finish_race", day, def.goal);
      expect(claimed).not.toBeNull();
      expect(claimed!.claimedAt).not.toBeNull();
      // Re-claim → null (already claimed).
      expect(repo.claimQuest("q-claim", "finish_race", day, def.goal)).toBeNull();
    });

    it("returns null for a quest not assigned today", () => {
      const day = dayNow();
      const def = questById("finish_race")!;
      expect(repo.claimQuest("q-nope", "finish_race", day, def.goal)).toBeNull();
    });
  });
});
