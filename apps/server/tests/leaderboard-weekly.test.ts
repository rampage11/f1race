import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile } from "@f1race/race-engine";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import { seasonWeek } from "../src/season.js";

const HERO: PilotProfile = {
  name: "Weekly Hero",
  country: "AT",
  team: "Redline",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

function seedProfile(repo: DriverProfileRepository, guestId: string): void {
  const now = Date.now();
  repo.upsert({
    guestId,
    hero: HERO,
    totalXp: 500,
    racesCount: 1,
    heroConfirmed: true,
    createdAt: now,
    updatedAt: now,
  });
}

function addRace(repo: DriverProfileRepository, guestId: string, finishedAt: number, xpGained: number): void {
  repo.addRaceResult({
    profileId: guestId,
    finishedAt,
    place: 1,
    gridPosition: 1,
    fastestLapDriverId: guestId,
    positionsGained: 0,
    xpGained,
    dnf: false,
  });
}

describe("S3-1: weekly leaderboard scope", () => {
  let dir: string;
  let repo: DriverProfileRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-weekly-"));
    repo = createRepository(join(dir, "weekly.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("only counts races within the current Monday-start UTC week", () => {
    seedProfile(repo, "wk-current");
    seedProfile(repo, "wk-last");

    const week = seasonWeek(Date.now());
    // A race inside this week.
    addRace(repo, "wk-current", week.weekStart + 1000, 200);
    // A race from the PREVIOUS week (just before this week's Monday).
    addRace(repo, "wk-last", week.weekStart - 1000, 999);

    const result = repo.weeklyLeaderboard(
      "F4",
      week.weekStart,
      week.weekEnd,
      50,
      { label: week.label, weekStart: week.weekStart, weekEnd: week.weekEnd, resetAt: week.weekEnd },
    );

    // Only the current-week racer appears.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.guestId).toBe("wk-current");
    expect(result.rows[0]!.xpGained).toBe(200);
  });

  it("races in different weeks do not cross-contaminate", () => {
    seedProfile(repo, "wk-cross");
    const week = seasonWeek(Date.now());
    // One race this week, one race last week.
    addRace(repo, "wk-cross", week.weekStart + 1000, 150);
    addRace(repo, "wk-cross", week.weekStart - 86_400_000, 850);

    const thisWeek = repo.weeklyLeaderboard(
      "F4", week.weekStart, week.weekEnd, 50,
      { label: week.label, weekStart: week.weekStart, weekEnd: week.weekEnd, resetAt: week.weekEnd },
      "wk-cross",
    );
    // SUM this week = 150, NOT 150+850.
    expect(thisWeek.rows[0]!.xpGained).toBe(150);

    // The viewer's own entry reflects only this week too.
    expect(thisWeek.me?.xpGained).toBe(150);
  });

  it("seasonWeek produces Monday-start weeks (label is ISO 8601)", () => {
    const w = seasonWeek(Date.now());
    expect(w.weekEnd).toBeGreaterThan(w.weekStart);
    expect(w.weekEnd - w.weekStart + 1).toBe(7 * 86_400_000);
    expect(w.label).toMatch(/^\d{4}-W\d{2}$/);
  });
});
