import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerHandle } from "../src/server.js";
import { launchServer } from "./helpers.js";
import { TokenBucketRateLimiter, createHttpRateLimiters, resolveRateBucket } from "../src/rate-limit.js";

let handle: ServerHandle;
let dir: string;
let prevEnv: Record<string, string | undefined>;

beforeAll(async () => {
  prevEnv = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    DB_PATH: process.env.DB_PATH,
    YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID,
    YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET,
  };
  dir = mkdtempSync(join(tmpdir(), "f1rate-prod-"));
  process.env.SESSION_SECRET = "prod-hardening-secret";
  process.env.DB_PATH = join(dir, "prod.db");
  delete process.env.YANDEX_CLIENT_ID;
  delete process.env.YANDEX_CLIENT_SECRET;
  handle = await launchServer();
});

afterAll(async () => {
  await handle.stop();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const base = (): string => `http://127.0.0.1:${handle.port}`;

describe("/health (S3-6)", () => {
  it("returns 200 with structured fields when the DB is reachable", async () => {
    const resp = await fetch(`${base()}/health`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("cache-control")).toMatch(/no-store/);
    const data = (await resp.json()) as {
      service: string;
      status: string;
      uptime: number;
      rooms: number;
      queuedClients: number;
      db: string;
    };
    expect(data.service).toBe("f1race-server");
    expect(data.status).toBe("ok");
    expect(data.db).toBe("ok");
    expect(Number.isFinite(data.uptime)).toBe(true);
    expect(data.rooms).toBeGreaterThanOrEqual(0);
    expect(data.queuedClients).toBeGreaterThanOrEqual(0);
  });

  it("is exempt from rate limiting (a large burst of probes never yields 429)", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 80; i++) {
      const r = await fetch(`${base()}/health`);
      codes.push(r.status);
    }
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});

describe("rate limiting on /api/* and /auth/* (S3-6)", () => {
  it("/api/* burst > 60 from one IP within a minute returns 429 with Retry-After", async () => {
    let first429: number | null = null;
    let retryAfter: string | null = null;
    for (let i = 0; i < 80; i++) {
      const r = await fetch(`${base()}/api/leaderboard?division=F4`);
      if (r.status === 429 && first429 === null) {
        first429 = i;
        retryAfter = r.headers.get("retry-after");
      }
    }
    expect(first429).not.toBeNull();
    // First 429 happens after the 60-token bucket is exhausted.
    expect(first429!).toBeGreaterThanOrEqual(60);
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter!, 10)).toBeGreaterThan(0);
  });

  it("OPTIONS preflight is exempt from rate limiting (returns 204 across a >capacity burst)", async () => {
    // 80 OPTIONS (capacity is 60 for /api) — all must succeed (204 or 404, but never 429).
    for (let i = 0; i < 80; i++) {
      const r = await fetch(`${base()}/api/leaderboard`, { method: "OPTIONS" });
      expect(r.status).not.toBe(429);
    }
  });
});

describe("TokenBucketRateLimiter (unit)", () => {
  it("admits up to `capacity` consecutive requests then denies the next", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 3, refillPerMs: 0 });
    expect(rl.consume("k", 1000)).toBe(true);
    expect(rl.consume("k", 1000)).toBe(true);
    expect(rl.consume("k", 1000)).toBe(true);
    expect(rl.consume("k", 1000)).toBe(false);
    expect(rl.retryAfterSec("k", 1000)).toBeGreaterThan(0);
  });

  it("refills tokens at the configured rate", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 2, refillPerMs: 1 / 1000 });
    expect(rl.consume("k", 0)).toBe(true);
    expect(rl.consume("k", 0)).toBe(true);
    expect(rl.consume("k", 0)).toBe(false);
    // After 1.5s we should have ~1.5 tokens, enough for one more consume.
    expect(rl.consume("k", 1500)).toBe(true);
  });

  it("treats different keys as independent buckets", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, refillPerMs: 0 });
    expect(rl.consume("a", 0)).toBe(true);
    expect(rl.consume("a", 0)).toBe(false);
    expect(rl.consume("b", 0)).toBe(true);
  });

  it("resolveRateBucket returns null for /health and OPTIONS", () => {
    const ls = createHttpRateLimiters();
    expect(resolveRateBucket("GET", "/health", ls)).toBeNull();
    expect(resolveRateBucket("OPTIONS", "/api/leaderboard", ls)).toBeNull();
    expect(resolveRateBucket("GET", "/auth/me", ls)!.name).toBe("auth");
    expect(resolveRateBucket("GET", "/api/stats", ls)!.name).toBe("api");
  });
});
