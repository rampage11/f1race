import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { PilotProfile } from "@f1race/race-engine";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import type { ServerHandle } from "../src/server.js";
import { signSession, verifySessionToken } from "../src/auth/session.js";
import {
  DEFAULT_YANDEX_HERO,
  exchangeCodeForToken,
  fetchYandexUserInfo,
  handleYandexCallback,
  type FetchLike,
} from "../src/auth/yandex.js";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import { closeClient, connectClient, launchServer, MsgStream, send } from "./helpers.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

const HERO: PilotProfile = {
  name: "Auth Hero",
  country: "AT",
  team: "Red Bull",
  skills: { fitness: 2, reaction: 2, attack: 2, defense: 2, pace: 1, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

interface MockState {
  accessToken: string;
  yandexId: string;
  email: string;
  tokenCalls: number;
  infoCalls: number;
}

function installYandexMock(state: MockState): typeof fetch {
  const prev = globalThis.fetch;
  const mock: FetchLike = (input, init) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input?.url ?? "");
    if (urlStr.startsWith("https://oauth.yandex.ru/token")) {
      state.tokenCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: state.accessToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (urlStr.startsWith("https://login.yandex.ru/info")) {
      state.infoCalls += 1;
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth !== `OAuth ${state.accessToken}`) {
        return Promise.resolve(new Response("unauthorized", { status: 401 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: state.yandexId,
            default_email: state.email,
            first_name: "Ivan",
            last_name: "Petrov",
            emails: [state.email],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    // Delegate to the real fetch (so test calls to the in-process HTTP server still work).
    return prev(input as Parameters<typeof fetch>[0], init as RequestInit);
  };
  (globalThis as { fetch: typeof fetch }).fetch = mock as typeof fetch;
  return prev;
}

describe("session token (signSession + verifySessionToken)", () => {
  const SECRET = "session-secret-test-123";

  it("round-trips a payload", () => {
    const tok = signSession({ sub: "yandex:42", iat: 1700000000 }, SECRET);
    expect(verifySessionToken(tok, SECRET)).toEqual({ sub: "yandex:42", iat: 1700000000 });
  });

  it("rejects a tampered payload (MAC mismatch)", () => {
    const tok = signSession({ sub: "yandex:42", iat: 1700000000 }, SECRET);
    const [payloadB64, macB64] = tok.split(".");
    const evilPayload = Buffer.from(
      JSON.stringify({ sub: "yandex:999", iat: 1700000000 }),
      "utf8",
    ).toString("base64url");
    const tampered = `${evilPayload}.${macB64}`;
    expect(verifySessionToken(tampered, SECRET)).toBeNull();
  });

  it("rejects malformed tokens (wrong shape, non-base64url, empty)", () => {
    expect(verifySessionToken("not-a-token", SECRET)).toBeNull();
    expect(verifySessionToken("a.b.c", SECRET)).toBeNull();
    expect(verifySessionToken("", SECRET)).toBeNull();
    expect(verifySessionToken("???.???", SECRET)).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const tok = signSession({ sub: "yandex:42", iat: 1 }, SECRET);
    expect(verifySessionToken(tok, "other-secret")).toBeNull();
  });

  it("returns null when secret is empty (auth disabled)", () => {
    const tok = signSession({ sub: "yandex:42", iat: 1 }, SECRET);
    expect(verifySessionToken(tok, "")).toBeNull();
  });

  it("rejects a token whose payload JSON is well-formed but missing required fields", () => {
    const payloadB64 = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64url");
    const macB64 = signSession({ sub: "x", iat: 1 }, SECRET).split(".")[1];
    expect(verifySessionToken(`${payloadB64}.${macB64}`, SECRET)).toBeNull();
  });
});

describe("Yandex OAuth: exchangeCodeForToken + fetchYandexUserInfo", () => {
  const mock: FetchLike = (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("https://oauth.yandex.ru/token")) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "tok-xyz" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    if (url.startsWith("https://login.yandex.ru/info")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "uid-1",
            default_email: "a@b.c",
            emails: ["a@b.c"],
            first_name: "A",
            last_name: "B",
            real_name: "Real A",
            display_name: "Disp",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };

  it("exchanges a code for an access token", async () => {
    const tok = await exchangeCodeForToken("c", "https://r", "cid", "csec", mock);
    expect(tok).toBe("tok-xyz");
  });

  it("throws when Yandex returns non-200", async () => {
    const fail: FetchLike = () => Promise.resolve(new Response("bad", { status: 400 }));
    await expect(exchangeCodeForToken("c", "https://r", "cid", "csec", fail)).rejects.toThrow(
      /token exchange/,
    );
  });

  it("extracts id, email, name from the user-info response (with fallbacks)", async () => {
    const info = await fetchYandexUserInfo("tok-xyz", mock);
    expect(info.id).toBe("uid-1");
    expect(info.email).toBe("a@b.c");
    expect(info.firstName).toBe("A");
    expect(info.lastName).toBe("B");
  });

  it("falls back through real_name / display_name when first_name is absent", async () => {
    const mock2: FetchLike = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: "uid-2", real_name: "RealOnly", emails: ["x@y.z"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const info = await fetchYandexUserInfo("t", mock2);
    expect(info.firstName).toBe("RealOnly");
    expect(info.email).toBe("x@y.z");
  });
});

describe("Yandex OAuth: handleYandexCallback (repo-level)", () => {
  let dir: string;
  let repo: DriverProfileRepository;
  let prevFetch: typeof fetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f1race-auth-"));
    repo = createRepository(join(dir, "auth.db"));
    prevFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = prevFetch;
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a new yandex:<id> profile (isNewUser=true) with the default hero", async () => {
    const state: MockState = {
      accessToken: "tok-1",
      yandexId: "uid-99",
      email: "u@example.com",
      tokenCalls: 0,
      infoCalls: 0,
    };
    installYandexMock(state);
    const result = await handleYandexCallback({
      code: "c",
      redirectUri: "http://localhost:5173/yandex-callback",
      clientId: "cid",
      clientSecret: "csec",
      sessionSecret: "ssh",
      repository: repo,
    });
    expect(result.isNewUser).toBe(true);
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(result.profileSummary.guestId).toBe("yandex:uid-99");
    expect(result.profileSummary.hero).toEqual(DEFAULT_YANDEX_HERO);
    expect(result.profileSummary.level).toBe(1);
    expect(result.profileSummary.division).toBe("F4");
    expect(result.profileSummary.totalXp).toBe(0);
    expect(verifySessionToken(result.sessionToken, "ssh")).toMatchObject({ sub: "yandex:uid-99" });
    expect(state.tokenCalls).toBe(1);
    expect(state.infoCalls).toBe(1);

    const stored = repo.get("yandex:uid-99");
    expect(stored).not.toBeNull();
    expect(stored!.hero).toEqual(DEFAULT_YANDEX_HERO);
  });

  it("returns isNewUser=false on a second callback for the same yandex id", async () => {
    const state: MockState = {
      accessToken: "tok-2",
      yandexId: "uid-100",
      email: "u@example.com",
      tokenCalls: 0,
      infoCalls: 0,
    };
    installYandexMock(state);
    const r1 = await handleYandexCallback({
      code: "c1",
      redirectUri: "http://localhost:5173/yandex-callback",
      clientId: "cid",
      clientSecret: "csec",
      sessionSecret: "ssh",
      repository: repo,
    });
    installYandexMock(state);
    const r2 = await handleYandexCallback({
      code: "c2",
      redirectUri: "http://localhost:5173/yandex-callback",
      clientId: "cid",
      clientSecret: "csec",
      sessionSecret: "ssh",
      repository: repo,
    });
    expect(r1.isNewUser).toBe(true);
    expect(r2.isNewUser).toBe(false);
    expect(r1.profileSummary.guestId).toBe(r2.profileSummary.guestId);
  });

  it("propagates token-exchange failures", async () => {
    const prev = globalThis.fetch;
    const fail: FetchLike = () => Promise.resolve(new Response("bad", { status: 400 }));
    (globalThis as { fetch: FetchLike }).fetch = fail as typeof fetch;
    try {
      await expect(
        handleYandexCallback({
          code: "c",
          redirectUri: "http://localhost:5173/yandex-callback",
          clientId: "cid",
          clientSecret: "csec",
          sessionSecret: "ssh",
          repository: repo,
        }),
      ).rejects.toThrow(/token exchange/);
    } finally {
      globalThis.fetch = prev;
    }
  });
});

describe("HTTP /auth/yandex/callback + /auth/me (configured)", () => {
  let handle: ServerHandle;
  let prevFetch: typeof fetch;
  let prevEnv: Record<string, string | undefined>;
  let clients: WebSocket[] = [];

  beforeAll(async () => {
    prevEnv = {
      YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID,
      YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET,
      SESSION_SECRET: process.env.SESSION_SECRET,
      DB_PATH: process.env.DB_PATH,
    };
    process.env.YANDEX_CLIENT_ID = "cid";
    process.env.YANDEX_CLIENT_SECRET = "csec";
    process.env.SESSION_SECRET = "ssh";
    process.env.DB_PATH = ":memory:";
    prevFetch = globalThis.fetch;
    handle = await launchServer();
  });

  afterAll(async () => {
    globalThis.fetch = prevFetch;
    for (const c of clients) await closeClient(c);
    clients = [];
    await handle.stop();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else (process.env as Record<string, string>)[k] = v;
    }
  });

  afterEach(() => {
    // Restore between tests so a non-delegating mock (e.g. the 502 failure test) cannot leak.
    globalThis.fetch = prevFetch;
  });

  function installMock(yandexId: string, email: string): void {
    installYandexMock({
      accessToken: "tok-" + yandexId,
      yandexId,
      email,
      tokenCalls: 0,
      infoCalls: 0,
    });
  }

  it("OPTIONS * returns 204 with CORS headers (preflight)", async () => {
    const resp = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
      method: "OPTIONS",
    });
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("access-control-allow-headers")).toMatch(/content-type/);
    expect(resp.headers.get("access-control-allow-methods")).toMatch(/GET, POST, OPTIONS/);
  });

  it("missing code/redirectUri returns 400", async () => {
    const resp = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "only" }),
    });
    expect(resp.status).toBe(400);
    const data = (await resp.json()) as { error: string };
    expect(data.error).toMatch(/code and redirectUri/);
  });

  it("invalid JSON body returns 400", async () => {
    const resp = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    expect(resp.status).toBe(400);
  });

  it("exchanges a code → returns sessionToken + profileSummary + isNewUser", async () => {
    installMock("uid-cb-1", "u@e.com");
    const resp = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "c",
        redirectUri: "http://localhost:5173/yandex-callback",
      }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    const data = (await resp.json()) as {
      sessionToken: string;
      profileSummary: { guestId: string; hero: PilotProfile; level: number; division: string };
      isNewUser: boolean;
    };
    expect(data.sessionToken).toMatch(/\./);
    expect(data.profileSummary.guestId).toBe("yandex:uid-cb-1");
    expect(data.profileSummary.level).toBe(1);
    expect(data.profileSummary.division).toBe("F4");
    expect(data.isNewUser).toBe(true);
  });

  it("token-exchange failure → 502", async () => {
    const prev = globalThis.fetch;
    const fail: FetchLike = (input, init) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input?.url ?? "");
      if (urlStr.startsWith("https://oauth.yandex.ru/")) {
        return Promise.resolve(new Response("bad", { status: 400 }));
      }
      return prev(input as Parameters<typeof fetch>[0], init as RequestInit);
    };
    (globalThis as { fetch: typeof fetch }).fetch = fail as typeof fetch;
    try {
      const resp = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "c",
          redirectUri: "http://localhost:5173/yandex-callback",
        }),
      });
      expect(resp.status).toBe(502);
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("GET /auth/me with valid Bearer returns the profile", async () => {
    installMock("uid-me-1", "me@example.com");
    const cb = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "c",
        redirectUri: "http://localhost:5173/yandex-callback",
      }),
    });
    const cbData = (await cb.json()) as { sessionToken: string };
    const token = cbData.sessionToken;

    const me = await fetch(`http://localhost:${handle.port}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    const meData = (await me.json()) as { guestId: string };
    expect(meData.guestId).toBe("yandex:uid-me-1");
  });

  it("GET /auth/me without Bearer returns 401", async () => {
    const me = await fetch(`http://localhost:${handle.port}/auth/me`);
    expect(me.status).toBe(401);
  });

  it("GET /auth/me with a tampered Bearer returns 401", async () => {
    const me = await fetch(`http://localhost:${handle.port}/auth/me`, {
      headers: { Authorization: "Bearer aaa.bbb" },
    });
    expect(me.status).toBe(401);
  });

  it("health route still works (default fall-through)", async () => {
    const resp = await fetch(`http://localhost:${handle.port}/`);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { service: string; status: string };
    expect(data.service).toBe("f1race-server");
    expect(data.status).toBe("ok");
  });

  it("hello with authToken resolves to yandex:<id> profile (ignoring client guestId)", async () => {
    installMock("uid-ws-1", "ws@example.com");
    const cb = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "c",
        redirectUri: "http://localhost:5173/yandex-callback",
      }),
    });
    const cbData = (await cb.json()) as { sessionToken: string };
    const authToken = cbData.sessionToken;

    const ws = await connectClient(handle.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      hero: HERO,
      guestId: "should-be-ignored",
      authToken,
    });
    const welcome = await stream.waitForType("welcome");
    expect(welcome.profile).toBeDefined();
    expect((welcome.profile as { guestId: string }).guestId).toBe("yandex:uid-ws-1");
    expect((welcome.profile as { guestId: string }).guestId).not.toBe("should-be-ignored");
  });

  it("hello with garbage authToken falls back to guest flow (no error to client)", async () => {
    const ws = await connectClient(handle.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      hero: HERO,
      authToken: "garbage.not-a-real-token",
    });
    const welcome = await stream.waitForType("welcome");
    expect(welcome.type).toBe("welcome");
    // No guestId + invalid authToken → ephemeral, no profile attached.
    expect(welcome.profile).toBeUndefined();
  });
});

describe("HTTP /auth/yandex/callback — 503 when Yandex creds unset", () => {
  let handle: ServerHandle;
  let prevEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    prevEnv = {
      YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID,
      YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET,
      SESSION_SECRET: process.env.SESSION_SECRET,
      DB_PATH: process.env.DB_PATH,
    };
    delete process.env.YANDEX_CLIENT_ID;
    delete process.env.YANDEX_CLIENT_SECRET;
    delete process.env.SESSION_SECRET;
    process.env.DB_PATH = ":memory:";
    handle = await launchServer();
  });

  afterAll(async () => {
    await handle.stop();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else (process.env as Record<string, string>)[k] = v;
    }
  });

  it("returns 503 with the not-configured error", async () => {
    const resp = await fetch(`http://localhost:${handle.port}/auth/yandex/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "c",
        redirectUri: "http://localhost:5173/yandex-callback",
      }),
    });
    expect(resp.status).toBe(503);
    const data = (await resp.json()) as { error: string };
    expect(data.error).toMatch(/not configured/);
  });

  it("WS still works in guest mode (no creds, no crash)", async () => {
    const clients: WebSocket[] = [];
    try {
      const ws = await connectClient(handle.port);
      clients.push(ws);
      const stream = new MsgStream(ws);
      send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
      const welcome = await stream.waitForType("welcome");
      expect(welcome.type).toBe("welcome");
      expect(welcome.driverId).toBeDefined();
    } finally {
      for (const c of clients) await closeClient(c);
    }
  });
});

describe("startServer throws when Yandex creds are set but SESSION_SECRET is missing", () => {
  let prevEnv: Record<string, string | undefined>;

  beforeEach(() => {
    prevEnv = {
      YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID,
      YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET,
      SESSION_SECRET: process.env.SESSION_SECRET,
      DB_PATH: process.env.DB_PATH,
    };
    process.env.YANDEX_CLIENT_ID = "cid";
    process.env.YANDEX_CLIENT_SECRET = "csec";
    delete process.env.SESSION_SECRET;
    process.env.DB_PATH = ":memory:";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else (process.env as Record<string, string>)[k] = v;
    }
  });

  it("rejects the boot", async () => {
    await expect(launchServer()).rejects.toThrow(/SESSION_SECRET is required/);
  });
});
