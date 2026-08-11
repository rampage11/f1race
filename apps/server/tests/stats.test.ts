import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile } from "@f1race/race-engine";
import { signSession } from "../src/auth/session.js";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import type { ServerHandle } from "../src/server.js";
import { launchServer } from "./helpers.js";

const SECRET = "api-stats-test-secret-12345";

const HERO_VALID: PilotProfile = {
  name: "Stats Hero",
  country: "AT",
  team: "Redline",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

let handle: ServerHandle;
let dir: string;
let dbPath: string;
let repo: DriverProfileRepository;
let prevEnv: Record<string, string | undefined>;

beforeAll(async () => {
  prevEnv = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    DB_PATH: process.env.DB_PATH,
    YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID,
    YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET,
  };
  dir = mkdtempSync(join(tmpdir(), "f1race-stats-"));
  dbPath = join(dir, "stats.db");
  process.env.SESSION_SECRET = SECRET;
  process.env.DB_PATH = dbPath;
  delete process.env.YANDEX_CLIENT_ID;
  delete process.env.YANDEX_CLIENT_SECRET;
  handle = await launchServer();
  repo = createRepository(dbPath);
});

afterAll(async () => {
  repo.close();
  await handle.stop();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

function token(sub: string): string {
  return signSession({ sub, iat: Date.now() }, SECRET);
}

function authHeaders(sub: string): Record<string, string> {
  return { Authorization: `Bearer ${token(sub)}` };
}

function seedProfile(guestId: string): void {
  const now = Date.now();
  repo.upsert({
    guestId,
    hero: HERO_VALID,
    totalXp: 0,
    racesCount: 0,
    heroConfirmed: true,
    createdAt: now,
    updatedAt: now,
  });
}

function seedRace(
  guestId: string,
  opts: { place: number; grid: number; xp: number; dnf?: boolean; finishedAt?: number },
): void {
  repo.addRaceResult({
    profileId: guestId,
    finishedAt: opts.finishedAt ?? Date.now(),
    place: opts.place,
    gridPosition: opts.grid,
    fastestLapDriverId: null,
    positionsGained: Math.max(0, opts.grid - opts.place),
    xpGained: opts.xp,
    dnf: opts.dnf ?? false,
  });
}

const base = (): string => `http://127.0.0.1:${handle.port}`;

describe("GET /api/stats (S2-5)", () => {
  it("returns 401 with no bearer token", async () => {
    const resp = await fetch(`${base()}/api/stats`);
    expect(resp.status).toBe(401);
  });

  it("returns zeroed stats for a profile with no race history", async () => {
    const gid = "stats-empty";
    seedProfile(gid);
    const resp = await fetch(`${base()}/api/stats`, { headers: authHeaders(gid) });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      stats: {
        totalRaces: number;
        wins: number;
        poles: number;
        podiums: number;
        bestFinish: number | null;
        averagePlace: number | null;
        dnfCount: number;
        totalXpGained: number;
      };
    };
    expect(data.stats.totalRaces).toBe(0);
    expect(data.stats.wins).toBe(0);
    expect(data.stats.poles).toBe(0);
    expect(data.stats.podiums).toBe(0);
    expect(data.stats.bestFinish).toBeNull();
    expect(data.stats.averagePlace).toBeNull();
    expect(data.stats.dnfCount).toBe(0);
    expect(data.stats.totalXpGained).toBe(0);
  });

  it("aggregates wins, poles, podiums, best/avg finish, dnf, xp over race_history", async () => {
    const gid = "stats-multi";
    seedProfile(gid);
    // 5 races: P1 from grid 2 (win + podium, pole=false), P2 from grid 1 (podium + pole),
    // P3 from grid 6 (podium), P8 from grid 8, DNF from grid 4.
    seedRace(gid, { place: 1, grid: 2, xp: 100 });
    seedRace(gid, { place: 2, grid: 1, xp: 60 });
    seedRace(gid, { place: 3, grid: 6, xp: 40 });
    seedRace(gid, { place: 8, grid: 8, xp: 10 });
    seedRace(gid, { place: 20, grid: 4, xp: 0, dnf: true });

    const resp = await fetch(`${base()}/api/stats`, { headers: authHeaders(gid) });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { stats: Record<string, unknown> };
    const s = data.stats as {
      totalRaces: number;
      wins: number;
      poles: number;
      podiums: number;
      bestFinish: number | null;
      averagePlace: number | null;
      dnfCount: number;
      totalXpGained: number;
    };
    expect(s.totalRaces).toBe(5);
    expect(s.wins).toBe(1);
    expect(s.poles).toBe(1);
    expect(s.podiums).toBe(3);
    expect(s.bestFinish).toBe(1);
    // avg place excludes the DNF: (1+2+3+8)/4 = 3.5
    expect(s.averagePlace).toBeCloseTo(3.5, 5);
    expect(s.dnfCount).toBe(1);
    expect(s.totalXpGained).toBe(210);
  });
});
