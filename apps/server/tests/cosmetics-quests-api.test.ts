import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { PilotProfile } from "@f1race/race-engine";
import { signSession } from "../src/auth/session.js";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import type { ServerHandle } from "../src/server.js";
import { launchServer } from "./helpers.js";
import { pickDailyQuestIds } from "../src/quests.js";
import { COSMETICS } from "../src/cosmetics.js";

const SECRET = "api-cosm-test-secret-999";

const HERO_VALID: PilotProfile = {
  name: "Cosmetics Hero",
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
  dir = mkdtempSync(join(tmpdir(), "f1race-cosm-"));
  dbPath = join(dir, "cosm.db");
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

function seed(guestId: string, opts: { totalXp?: number; softCurrency?: number; confirmed?: boolean } = {}): void {
  const now = Date.now();
  repo.upsert({
    guestId,
    hero: HERO_VALID,
    totalXp: opts.totalXp ?? 0,
    racesCount: 0,
    heroConfirmed: opts.confirmed ?? true,
    softCurrency: opts.softCurrency ?? 0,
    createdAt: now,
    updatedAt: now,
  });
}

const base = (): string => `http://127.0.0.1:${handle.port}`;

describe("GET /api/cosmetics/catalog", () => {
  it("returns the static catalog (public, no auth needed)", async () => {
    const resp = await fetch(`${base()}/api/cosmetics/catalog`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { catalog: typeof COSMETICS };
    expect(data.catalog.length).toBeGreaterThanOrEqual(8);
  });
});

describe("GET /api/cosmetics/owned", () => {
  it("returns 401 without auth", async () => {
    const resp = await fetch(`${base()}/api/cosmetics/owned`);
    expect(resp.status).toBe(401);
  });

  it("returns empty owned + the wallet balance", async () => {
    const gid = "cosm-owned";
    seed(gid, { softCurrency: 42 });
    const resp = await fetch(`${base()}/api/cosmetics/owned`, { headers: authHeaders(gid) });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { owned: string[]; equipped: object; softCurrency: number };
    expect(data.owned).toEqual([]);
    expect(data.softCurrency).toBe(42);
  });
});

describe("POST /api/cosmetics/buy", () => {
  it("buys a free (cost 0) item at level 1", async () => {
    const gid = "cosm-buy-free";
    seed(gid, { totalXp: 0, softCurrency: 0 });
    const resp = await fetch(`${base()}/api/cosmetics/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "accent_blue" }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { owned: string[]; softCurrency: number };
    expect(data.owned).toContain("accent_blue");
    expect(data.softCurrency).toBe(0);
  });

  it("rejects a paid item below the level gate (403)", async () => {
    const gid = "cosm-buy-lowlevel";
    seed(gid, { totalXp: 0, softCurrency: 1000 });
    // number_11 requires level 3.
    const resp = await fetch(`${base()}/api/cosmetics/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "number_11" }),
    });
    expect(resp.status).toBe(403);
  });

  it("rejects a paid item with insufficient currency (402)", async () => {
    const gid = "cosm-buy-nofunds";
    // Level 3 needs ~346 xp; give enough level but not enough currency (number_11 costs 50).
    seed(gid, { totalXp: 400, softCurrency: 10 });
    const resp = await fetch(`${base()}/api/cosmetics/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "number_11" }),
    });
    expect(resp.status).toBe(402);
  });

  it("buys a paid item when level + currency are met, deducting the cost", async () => {
    const gid = "cosm-buy-ok";
    seed(gid, { totalXp: 400, softCurrency: 100 });
    const resp = await fetch(`${base()}/api/cosmetics/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "number_11" }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { owned: string[]; softCurrency: number };
    expect(data.owned).toContain("number_11");
    expect(data.softCurrency).toBe(50); // 100 - 50 cost.
  });

  it("rejects buying an already-owned item (409)", async () => {
    const gid = "cosm-buy-dupe";
    seed(gid, { softCurrency: 0 });
    await fetch(`${base()}/api/cosmetics/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "accent_green" }),
    });
    const resp = await fetch(`${base()}/api/cosmetics/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "accent_green" }),
    });
    expect(resp.status).toBe(409);
  });
});

describe("POST /api/cosmetics/equip", () => {
  it("equips an owned item", async () => {
    const gid = "cosm-equip";
    seed(gid, { softCurrency: 0 });
    await fetch(`${base()}/api/cosmetics/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "number_7" }),
    });
    const resp = await fetch(`${base()}/api/cosmetics/equip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "number_7" }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { equipped: { carNumber?: string } };
    expect(data.equipped.carNumber).toBe("number_7");
    // Persisted: a fresh owned read reflects the equipped slot.
    const owned = await (await fetch(`${base()}/api/cosmetics/owned`, { headers: authHeaders(gid) })).json() as { equipped: { carNumber?: string } };
    expect(owned.equipped.carNumber).toBe("number_7");
  });

  it("rejects equipping a not-owned item (403)", async () => {
    const gid = "cosm-equip-notowned";
    seed(gid, { softCurrency: 0 });
    const resp = await fetch(`${base()}/api/cosmetics/equip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ unlockId: "accent_red" }),
    });
    expect(resp.status).toBe(403);
  });
});

describe("POST /api/quests/claim (HTTP: xp + currency award)", () => {
  it("claims a completed quest and awards xp + currency", async () => {
    const gid = "cosm-claim";
    seed(gid, { totalXp: 0, softCurrency: 0 });
    const day = Math.floor(Date.now() / 86_400_000);
    // Force-assign finish_race today and complete it.
    repo.assignDailyQuests(gid, day, ["finish_race"]);
    repo.incrementQuestProgress(gid, "finish_race", day, 1);

    const resp = await fetch(`${base()}/api/quests/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ questDefId: "finish_race" }),
    });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as {
      quests: { questDefId: string; claimed: boolean }[];
      profile: { totalXp: number; softCurrency: number };
      claimed: { questDefId: string; xp: number; currency: number };
    };
    expect(data.claimed.xp).toBe(30);
    expect(data.claimed.currency).toBe(15);
    expect(data.profile.totalXp).toBe(30);
    expect(data.profile.softCurrency).toBe(15);
    const fq = data.quests.find((q) => q.questDefId === "finish_race")!;
    expect(fq.claimed).toBe(true);
  });

  it("rejects claiming an incomplete quest (409)", async () => {
    const gid = "cosm-claim-incomplete";
    seed(gid, { totalXp: 0, softCurrency: 0 });
    const day = Math.floor(Date.now() / 86_400_000);
    repo.assignDailyQuests(gid, day, pickDailyQuestIds(gid, day));
    // No progress made → claim should fail.
    const resp = await fetch(`${base()}/api/quests/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(gid) },
      body: JSON.stringify({ questDefId: "finish_race" }),
    });
    // finish_race may or may not be assigned today; either way it's not complete → 409 or 404.
    expect([409, 404]).toContain(resp.status);
  });
});

describe("GET /api/quests/state", () => {
  it("lazy-assigns 3 quests on first read and returns progress views", async () => {
    const gid = "cosm-quests-state";
    seed(gid, { totalXp: 0, softCurrency: 0 });
    const resp = await fetch(`${base()}/api/quests/state`, { headers: authHeaders(gid) });
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { quests: { questDefId: string; desc: string; goal: number; progress: number; claimed: boolean }[] };
    expect(data.quests).toHaveLength(3);
    for (const q of data.quests) {
      expect(q.desc.length).toBeGreaterThan(0);
      expect(q.goal).toBeGreaterThan(0);
      expect(q.claimed).toBe(false);
    }
    // A second read returns the same 3 (idempotent).
    const resp2 = await fetch(`${base()}/api/quests/state`, { headers: authHeaders(gid) });
    const data2 = (await resp2.json()) as { quests: { questDefId: string }[] };
    expect(data2.quests.map((q) => q.questDefId).sort()).toEqual(data.quests.map((q) => q.questDefId).sort());
  });
});
