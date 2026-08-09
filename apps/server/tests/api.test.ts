import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile, Skills } from "@f1race/race-engine";
import { signSession } from "../src/auth/session.js";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import type { ServerHandle } from "../src/server.js";
import { launchServer } from "./helpers.js";

const SECRET = "api-test-secret-12345";

const HERO_VALID: PilotProfile = {
  name: "Api Hero",
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
  dir = mkdtempSync(join(tmpdir(), "f1race-api-"));
  dbPath = join(dir, "api.db");
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

function seedProfile(
  guestId: string,
  hero: PilotProfile = HERO_VALID,
  heroConfirmed = false,
): void {
  const now = Date.now();
  repo.upsert({
    guestId,
    hero,
    totalXp: 0,
    racesCount: 0,
    heroConfirmed,
    createdAt: now,
    updatedAt: now,
  });
}

function authHeaders(sub: string): Record<string, string> {
  return { Authorization: `Bearer ${token(sub)}` };
}

const base = (): string => `http://127.0.0.1:${handle.port}`;

describe("/api/profile/confirm", () => {
  it("returns 401 with no bearer token", async () => {
    const resp = await fetch(`${base()}/api/profile/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hero: HERO_VALID }),
    });
    expect(resp.status).toBe(401);
  });

  it("returns 400 on an invalid JSON body", async () => {
    seedProfile("api-confirm-badbody");
    const resp = await fetch(`${base()}/api/profile/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders("api-confirm-badbody") },
      body: "not-json{{{",
    });
    expect(resp.status).toBe(400);
  });

  it("returns 400 on an invalid hero (missing fields)", async () => {
    seedProfile("api-confirm-invalid");
    const resp = await fetch(`${base()}/api/profile/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders("api-confirm-invalid") },
      body: JSON.stringify({ hero: { name: "x" } }),
    });
    expect(resp.status).toBe(400);
  });

  it("returns 400 on a bad skill allocation (sum != 10)", async () => {
    seedProfile("api-confirm-alloc");
    const resp = await fetch(`${base()}/api/profile/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders("api-confirm-alloc") },
      body: JSON.stringify({
        hero: {
          ...HERO_VALID,
          skills: { fitness: 5, reaction: 5, attack: 5, defense: 5, pace: 5, tyreMgmt: 5 },
        },
      }),
    });
    expect(resp.status).toBe(400);
  });

  it("confirms a valid hero (200); a second confirm is rejected (409)", async () => {
    const gid = "api-confirm-ok";
    seedProfile(gid);
    const resp = await fetch(`${base()}/api/profile/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ hero: HERO_VALID }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      training: { status: string };
      profile: { heroConfirmed: boolean; hero: PilotProfile; division: string };
      justCompleted?: unknown;
    };
    expect(data.profile.heroConfirmed).toBe(true);
    expect(data.profile.hero).toEqual(HERO_VALID);
    expect(data.training.status).toBe("idle");
    expect(data.justCompleted).toBeUndefined();

    const again = await fetch(`${base()}/api/profile/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ hero: HERO_VALID }),
    });
    expect(again.status).toBe(409);
  });
});

describe("/api/training/state", () => {
  it("returns 401 with no bearer token", async () => {
    const resp = await fetch(`${base()}/api/training/state`);
    expect(resp.status).toBe(401);
  });

  it("returns idle for a confirmed profile with no active training", async () => {
    const gid = "api-state-idle";
    seedProfile(gid, HERO_VALID, true);
    const resp = await fetch(`${base()}/api/training/state`, {
      headers: authHeaders(gid),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      training: { status: string };
      profile: { heroConfirmed: boolean };
    };
    expect(data.training.status).toBe("idle");
    expect(data.profile.heroConfirmed).toBe(true);
  });

  it("returns 403 for an unconfirmed profile", async () => {
    const gid = "api-state-unconfirmed";
    seedProfile(gid, HERO_VALID, false);
    const resp = await fetch(`${base()}/api/training/state`, {
      headers: authHeaders(gid),
    });
    expect(resp.status).toBe(403);
  });
});

describe("/api/training/start + /api/training/cancel", () => {
  it("starts an active training, reflects it in state, rejects a concurrent start, then cancels", async () => {
    const gid = "api-start";
    seedProfile(gid, HERO_VALID, true);

    const startResp = await fetch(`${base()}/api/training/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ skill: "pace" }),
    });
    expect(startResp.status).toBe(200);
    const startData = (await startResp.json()) as {
      training: { status: string; durationSec: number; skill: string; remainingSec: number };
    };
    expect(startData.training.status).toBe("active");
    expect(startData.training.skill).toBe("pace");
    expect(startData.training.durationSec).toBeGreaterThan(0);
    expect(startData.training.remainingSec).toBeGreaterThan(0);

    const stateResp = await fetch(`${base()}/api/training/state`, {
      headers: authHeaders(gid),
    });
    const stateData = (await stateResp.json()) as { training: { status: string; skill: string } };
    expect(stateData.training.status).toBe("active");
    expect(stateData.training.skill).toBe("pace");

    const secondStart = await fetch(`${base()}/api/training/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ skill: "fitness" }),
    });
    expect(secondStart.status).toBe(409);

    const cancelResp = await fetch(`${base()}/api/training/cancel`, {
      method: "POST",
      headers: authHeaders(gid),
    });
    expect(cancelResp.status).toBe(200);
    const cancelData = (await cancelResp.json()) as { training: { status: string } };
    expect(cancelData.training.status).toBe("idle");

    const stateAfter = await fetch(`${base()}/api/training/state`, {
      headers: authHeaders(gid),
    });
    const afterData = (await stateAfter.json()) as { training: { status: string } };
    expect(afterData.training.status).toBe("idle");
  });

  it("returns 400 when the requested skill is not a SkillKey", async () => {
    const gid = "api-start-badskill";
    seedProfile(gid, HERO_VALID, true);
    const resp = await fetch(`${base()}/api/training/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ skill: "nonsense" }),
    });
    expect(resp.status).toBe(400);
  });

  it("returns 403 on /api/training/start for an unconfirmed profile", async () => {
    const gid = "api-start-unconfirmed";
    seedProfile(gid, HERO_VALID, false);
    const resp = await fetch(`${base()}/api/training/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ skill: "pace" }),
    });
    expect(resp.status).toBe(403);
  });
});

describe("/api/training/state: lazy completion of an elapsed training", () => {
  it("completes an elapsed training on read, increments the skill, and reports justCompleted", async () => {
    const gid = "api-lazy";
    seedProfile(gid, HERO_VALID, true);
    const before = repo.get(gid)!;
    expect(before.hero.skills.pace).toBe(3);

    const durationSec = 600;
    const startedAt = Date.now() - durationSec - 1000;
    repo.startTraining(gid, "pace", startedAt, durationSec);
    expect(repo.getActiveTraining(gid)).not.toBeNull();

    const resp = await fetch(`${base()}/api/training/state`, {
      headers: authHeaders(gid),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      training: { status: string };
      justCompleted?: { skill: string; newLevel: number };
      profile: { hero: PilotProfile };
    };
    expect(data.training.status).toBe("idle");
    expect(data.justCompleted).toBeDefined();
    expect(data.justCompleted!.skill).toBe("pace");
    expect(data.justCompleted!.newLevel).toBe(4);
    expect(data.profile.hero.skills.pace).toBe(4);

    const stored = repo.get(gid);
    expect(stored).not.toBeNull();
    expect(stored!.hero.skills.pace).toBe(4);
    expect(repo.getActiveTraining(gid)).toBeNull();
  });
});

describe("/api/profile/respec", () => {
  // totalXp >= 1703 → level 5 (cumulative xpToNext: 100+283+520+800).
  const LEVEL5_XP = 1800;
  const RESPECED: Skills = { fitness: 3, reaction: 1, attack: 2, defense: 2, pace: 1, tyreMgmt: 1 };

  function seedAt(guestId: string, totalXp: number, confirmed = true): void {
    const now = Date.now();
    repo.upsert({
      guestId,
      hero: HERO_VALID,
      totalXp,
      racesCount: 0,
      heroConfirmed: confirmed,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("returns 401 with no bearer token", async () => {
    const resp = await fetch(`${base()}/api/profile/respec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills: RESPECED }),
    });
    expect(resp.status).toBe(401);
  });

  it("returns 403 for an unconfirmed profile", async () => {
    seedAt("api-respec-unconf", LEVEL5_XP, false);
    const resp = await fetch(`${base()}/api/profile/respec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders("api-respec-unconf") },
      body: JSON.stringify({ skills: RESPECED }),
    });
    expect(resp.status).toBe(403);
  });

  it("is locked below respec.freeLevel (level < 5 → 409 unlock message)", async () => {
    seedAt("api-respec-lowlevel", 100);
    const resp = await fetch(`${base()}/api/profile/respec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders("api-respec-lowlevel") },
      body: JSON.stringify({ skills: RESPECED }),
    });
    expect(resp.status).toBe(409);
    const data = (await resp.json()) as { error: string };
    expect(data.error).toMatch(/unlocks at level 5/);
  });

  it("rejects a non-point-neutral allocation (sum != current) with 400", async () => {
    seedAt("api-respec-alloc", LEVEL5_XP);
    const resp = await fetch(`${base()}/api/profile/respec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders("api-respec-alloc") },
      body: JSON.stringify({ skills: { fitness: 5, reaction: 5, attack: 5, defense: 5, pace: 5, tyreMgmt: 5 } }),
    });
    expect(resp.status).toBe(400);
  });

  it("grants one free respec at level 5, then gates the next by the cooldown (409)", async () => {
    const gid = "api-respec-free";
    seedAt(gid, LEVEL5_XP);
    const ok = await fetch(`${base()}/api/profile/respec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ skills: RESPECED }),
    });
    expect(ok.status).toBe(200);
    const data = (await ok.json()) as { profile: { hero: PilotProfile } };
    expect(data.profile.hero.skills).toEqual(RESPECED);

    const stored = repo.get(gid)!;
    expect(stored.freeRespecUsed).toBe(true);
    expect(stored.lastRespecAt).not.toBeNull();

    const again = await fetch(`${base()}/api/profile/respec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ skills: HERO_VALID.skills }),
    });
    expect(again.status).toBe(409);
    const againData = (await again.json()) as { error: string };
    expect(againData.error).toMatch(/available in/);
  });
});
