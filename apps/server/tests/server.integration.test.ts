import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { PilotProfile } from "@f1race/race-engine";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import type { ServerHandle } from "../src/server.js";
import type { Room } from "../src/room.js";
import { closeClient, connectClient, launchServer, MsgStream, send } from "./helpers.js";

const HERO: PilotProfile = {
  name: "Test Hero",
  country: "AT",
  team: "Redmine",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

const HERO_B: PilotProfile = {
  name: "Hero Beta",
  country: "JP",
  team: "Crimson",
  skills: { fitness: 2, reaction: 1, attack: 2, defense: 2, pace: 1, tyreMgmt: 2 },
  startingTyre: "soft",
  pitCompound: "medium",
};

let handle: ServerHandle | null = null;
let prevDbPath: string | undefined;

beforeAll(async () => {
  // Hermetic per-worker in-memory DB so guestId persistence tests never touch disk.
  prevDbPath = process.env.DB_PATH;
  process.env.DB_PATH = ":memory:";
  handle = await launchServer();
});

afterAll(async () => {
  if (handle) {
    await handle.stop();
    handle = null;
  }
  if (prevDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = prevDbPath;
});

async function waitForRoomState(stream: MsgStream, playerCount: number, timeoutMs = 3000): Promise<{
  type: "roomState";
  mode: string;
  players: { driverId: string; name: string; connected: boolean }[];
}> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`timeout waiting for roomState with ${playerCount} players`);
    const msg = await stream.next(remaining);
    if (
      msg &&
      typeof msg === "object" &&
      (msg as { type?: string }).type === "roomState" &&
      Array.isArray((msg as { players?: unknown }).players) &&
      (msg as { players: unknown[] }).players.length === playerCount
    ) {
      return msg as { type: "roomState"; mode: string; players: { driverId: string; name: string; connected: boolean }[] };
    }
  }
}

describe("WS protocol: handshake & errors", () => {
  let ws: WebSocket;
  let stream: MsgStream;

  beforeEach(async () => {
    ws = await connectClient(handle!.port);
    stream = new MsgStream(ws);
  });

  afterEach(async () => {
    await closeClient(ws);
  });

  it("hello yields lobbyState, then welcome, then stage(qualy), then snapshot", async () => {
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });

    const lobby = await stream.waitForType("lobbyState");
    expect(lobby.type).toBe("lobbyState");
    expect(lobby.division).toBe("F4");

    const welcome = await stream.waitForType("welcome");
    expect(welcome).toMatchObject({ type: "welcome" });
    expect(typeof welcome.driverId).toBe("string");
    expect(welcome.driverId.length).toBeGreaterThan(0);
    expect(typeof welcome.sessionToken).toBe("string");
    expect(welcome.sessionToken.length).toBeGreaterThan(0);
    expect(welcome.mode).toBe("solo");

    const stage = await stream.waitForType("stage");
    expect(stage).toMatchObject({ type: "stage", stage: "qualy" });

    const snap = await stream.waitForType("snapshot");
    expect(snap.type).toBe("snapshot");
    expect(snap.stage).toBe("qualy");
    expect(typeof snap.heroId).toBe("string");
    expect(snap.heroId.length).toBeGreaterThan(0);
    expect(snap.heroId).toBe(welcome.driverId);
    expect(typeof snap.snapshot.time).toBe("number");
    expect(Array.isArray(snap.snapshot.cars)).toBe(true);
    expect(snap.snapshot.cars).toHaveLength(20);
    expect(["running", "finished"]).toContain(snap.snapshot.phase);
    expect(snap.snapshot.cars.some((c: { driverId: string }) => c.driverId === snap.heroId)).toBe(true);
  });

  it("hello with wrong protocolVersion yields error and creates no session", async () => {
    send(ws, { type: "hello", protocolVersion: 999, hero: HERO });

    const err = await stream.next();
    expect(err).toMatchObject({ type: "error" });
    expect(err.message).toMatch(/protocol version mismatch/);

    send(ws, { type: "restart" });
    await expect(stream.next(300)).rejects.toThrow(/timeout/);
  });

  it("invalid json yields error", async () => {
    ws.send("not-valid-json-{{{");

    const err = await stream.next();
    expect(err).toMatchObject({ type: "error" });
    expect(err.message).toMatch(/invalid json/i);
  });

  it("rejects a second live session with the same guestId (one account, two devices)", async () => {
    const guestId = `dup-session-${Date.now()}`;
    // First device: hello → matched into a room → welcome (live connection established).
    const wsA = await connectClient(handle!.port);
    const streamA = new MsgStream(wsA);
    send(wsA, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO, guestId });
    await streamA.waitForType("welcome");

    // Second device, SAME guestId → must be rejected, not welcomed.
    const wsB = await connectClient(handle!.port);
    const streamB = new MsgStream(wsB);
    send(wsB, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B, guestId });
    const err = await streamB.waitForType("error");
    expect(err.message).toMatch(/already in a race/i);

    await closeClient(wsA);
    await closeClient(wsB);
  });

  it("snapshot stream is periodic (>=3 monotonic snapshots within 1.5s)", async () => {
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    await stream.waitForType("stage");
    await stream.waitForType("snapshot");

    const snaps: Array<{ snapshot: { time: number } }> = [];
    for (let i = 0; i < 3; i++) snaps.push(await stream.waitForType("snapshot", 1500));

    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i]!.snapshot.time).toBeGreaterThanOrEqual(snaps[i - 1]!.snapshot.time);
    }
  });

  it("restart re-emits qualy stage and a fresh snapshot", async () => {
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    await stream.waitForType("stage");
    await stream.waitForType("snapshot");

    send(ws, { type: "restart" });

    const stage2 = await stream.waitForType("stage", 1500);
    expect(stage2).toMatchObject({ type: "stage", stage: "qualy" });

    const snap2 = await stream.waitForType("snapshot", 1500);
    expect(snap2.snapshot.time).toBeLessThanOrEqual(1);
  });
});

describe("WS protocol: race-stage flows (fast-race bypass via __advanceForTest)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  // Match a lone player into a room, then drive it to the race stage synchronously.
  async function reachRace(): Promise<{ ws: WebSocket; stream: MsgStream; room: Room; heroId: string }> {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    const welcome = await stream.waitForType("welcome");
    const heroId = welcome.driverId as string;
    await stream.waitForType("snapshot");
    // Find the room this player was matched into (the server may hold leftover rooms from
    // earlier tests whose disconnected drivers are still within their grace period).
    const room = Array.from(handle!.rooms.values()).find((r) => r.testHasDriverId(heroId)) as Room;
    room.__advanceForTest({ stopAtRace: true });
    await stream.waitForType("snapshot", 3000);
    return { ws, stream, room, heroId };
  }

  it("pit command sets pitPending on hero during race", async () => {
    const { ws, stream, heroId } = await reachRace();
    send(ws, { type: "pit", compound: "hard" });

    const deadline = Date.now() + 3000;
    let matched = false;
    while (Date.now() < deadline && !matched) {
      const snap = await stream.waitForType("snapshot", Math.min(1000, deadline - Date.now()));
      const hero = (snap.snapshot.cars as { driverId: string; pitPending: boolean }[]).find(
        (c) => c.driverId === heroId,
      );
      if (hero && hero.pitPending) { matched = true; break; }
    }
    expect(matched).toBe(true);
  });

  it("cancelPit resets pitPending after a pit request", async () => {
    const { ws, stream, heroId } = await reachRace();
    send(ws, { type: "pit", compound: "hard" });

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const snap = await stream.waitForType("snapshot", Math.min(1000, deadline - Date.now()));
      const hero = (snap.snapshot.cars as { driverId: string; pitPending: boolean }[]).find(
        (c) => c.driverId === heroId,
      );
      if (hero && hero.pitPending) break;
    }

    send(ws, { type: "cancelPit" });
    let cleared = false;
    const deadline2 = Date.now() + 3000;
    while (Date.now() < deadline2 && !cleared) {
      const snap = await stream.waitForType("snapshot", Math.min(1000, deadline2 - Date.now()));
      const hero = (snap.snapshot.cars as { driverId: string; pitPending: boolean }[]).find(
        (c) => c.driverId === heroId,
      );
      if (hero && !hero.pitPending) { cleared = true; break; }
    }
    expect(cleared).toBe(true);
  });
});

describe("WS protocol: reconnection (Phase 1, P5)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("reconnect within grace restores the same driverId and resumes snapshots", async () => {
    const ws1 = await connectClient(handle!.port);
    clients.push(ws1);
    const stream1 = new MsgStream(ws1);
    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    const welcome1 = await stream1.waitForType("welcome");
    const token = welcome1.sessionToken as string;
    const driverId = welcome1.driverId as string;
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    await stream1.waitForType("snapshot");

    await closeClient(ws1);
    clients = [];

    const ws2 = await connectClient(handle!.port);
    clients.push(ws2);
    const stream2 = new MsgStream(ws2);
    send(ws2, { type: "reconnect", sessionToken: token });

    const welcome2 = await stream2.waitForType("welcome");
    expect(welcome2.driverId).toBe(driverId);
    expect(welcome2.sessionToken).toBe(token);
    expect(welcome2.mode).toBeDefined();

    const stage = await stream2.waitForType("stage");
    expect(stage.stage).toBe("qualy");

    const snap = await stream2.waitForType("snapshot");
    expect(snap.heroId).toBe(driverId);
    expect(snap.snapshot.cars).toHaveLength(20);
  });

  it("reconnect with an unknown token yields an error", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "reconnect", sessionToken: "no-such-room:no-driver:deadbeef" });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/invalid or expired session token/);
  });

  it("reconnect after grace expiry yields an error", async () => {
    const prev = process.env.GRACE_PERIOD_MS;
    process.env.GRACE_PERIOD_MS = "120";
    try {
      const ws1 = await connectClient(handle!.port);
      clients.push(ws1);
      const stream1 = new MsgStream(ws1);
      send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
      const welcome1 = await stream1.waitForType("welcome");
      const token = welcome1.sessionToken as string;

      await closeClient(ws1);
      clients = [];

      await new Promise((r) => setTimeout(r, 500));

      const ws2 = await connectClient(handle!.port);
      clients.push(ws2);
      const stream2 = new MsgStream(ws2);
      send(ws2, { type: "reconnect", sessionToken: token });

      const err = await stream2.waitForType("error");
      expect(err.message).toMatch(/invalid or expired session token/);
    } finally {
      if (prev === undefined) delete process.env.GRACE_PERIOD_MS;
      else process.env.GRACE_PERIOD_MS = prev;
    }
  });
});

describe("WS protocol: input-window & rate-limit (Phase 1, P6/P17)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  async function helloHero(): Promise<{ ws: WebSocket; stream: MsgStream }> {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    await stream.waitForType("snapshot");
    return { ws, stream };
  }

  it("pit during qualifying yields an explicit error (P17 — no silent drop)", async () => {
    const { ws, stream } = await helloHero();
    send(ws, { type: "pit", compound: "hard" });
    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/pit only available during the race/);
  });

  it("cancelPit during qualifying yields an explicit error (P17)", async () => {
    const { ws, stream } = await helloHero();
    send(ws, { type: "cancelPit" });
    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/pit only available during the race/);
  });

  it("spamming pit trips the per-connection rate limit (P6)", async () => {
    const { ws, stream } = await helloHero();
    for (let i = 0; i < 6; i++) send(ws, { type: "pit", compound: "hard" });

    const errors: string[] = [];
    const deadline = Date.now() + 3000;
    while (errors.length < 6 && Date.now() < deadline) {
      try {
        const m = await stream.waitForType("error", Math.min(800, deadline - Date.now()));
        errors.push(m.message as string);
      } catch {
        break;
      }
    }
    expect(errors.some((m) => /rate limit: pit/.test(m))).toBe(true);
  });

  it("restart has a longer rate limit than pit (P6)", async () => {
    const { ws, stream } = await helloHero();
    send(ws, { type: "restart" });
    await stream.waitForType("stage");
    send(ws, { type: "restart" });
    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/rate limit: restart/);
  });
});

describe("WS protocol: mode + spectator gating (Phase 1, P3)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("welcome.mode and roomState.mode are 'solo' with one client and 'multiplayer' with two", async () => {
    const ws1 = await connectClient(handle!.port);
    const ws2 = await connectClient(handle!.port);
    clients.push(ws1, ws2);
    const stream1 = new MsgStream(ws1);
    const stream2 = new MsgStream(ws2);

    // Send both hellos back-to-back so the lobby groups them into the same room (a sequential
    // hello→await→hello would let the first client solo-match before the second enqueues).
    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });

    const welcome1 = await stream1.waitForType("welcome");
    // First addConnection in the grouped room sees only itself → solo mode.
    expect(welcome1.mode).toBe("solo");
    const welcome2 = await stream2.waitForType("welcome");
    expect(welcome2.mode).toBe("multiplayer");

    const state1 = await waitForRoomState(stream1, 2);
    const state2 = await waitForRoomState(stream2, 2);
    expect(state1.mode).toBe("multiplayer");
    expect(state2.mode).toBe("multiplayer");
  });

  it("speed/pause commands are rejected in multiplayer and applied in solo (P3)", async () => {
    const ws1 = await connectClient(handle!.port);
    const ws2 = await connectClient(handle!.port);
    clients.push(ws1, ws2);
    const stream1 = new MsgStream(ws1);
    const stream2 = new MsgStream(ws2);

    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });
    await stream1.waitForType("snapshot");
    await waitForRoomState(stream1, 2);

    send(ws1, { type: "speed", value: 12 });
    const errSpeed = await stream1.waitForType("error");
    expect(errSpeed.message).toMatch(/speed control not available in multiplayer/);

    send(ws1, { type: "pause", paused: true });
    const errPause = await stream1.waitForType("error");
    expect(errPause.message).toMatch(/pause control not available in multiplayer/);
  });
});

describe("WS protocol: guest identity & profile load (Phase 3)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("hello with guestId yields welcome.profile at level 1 / F4", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    const guestId = `gid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO, guestId });

    const welcome = await stream.waitForType("welcome");
    expect(welcome.profile).toBeDefined();
    expect(welcome.profile.guestId).toBe(guestId);
    expect(welcome.profile.level).toBe(1);
    expect(welcome.profile.division).toBe("F4");
    expect(welcome.profile.totalXp).toBe(0);
    expect(welcome.profile.racesCount).toBe(0);
  });

  it("a second hello with the same guestId reuses the stored profile (load-on-rejoin)", async () => {
    const guestId = `gid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const ws1 = await connectClient(handle!.port);
    clients.push(ws1);
    const stream1 = new MsgStream(ws1);
    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO, guestId });
    const welcome1 = await stream1.waitForType("welcome");
    expect(welcome1.profile).toBeDefined();
    expect(welcome1.profile.guestId).toBe(guestId);
    await closeClient(ws1);
    clients = [];

    const ws2 = await connectClient(handle!.port);
    clients.push(ws2);
    const stream2 = new MsgStream(ws2);
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO, guestId });
    const welcome2 = await stream2.waitForType("welcome");
    expect(welcome2.profile).toBeDefined();
    expect(welcome2.profile.guestId).toBe(guestId);
    expect(welcome2.profile.level).toBe(1);
    expect(welcome2.profile.racesCount).toBe(0);
  });

  it("hello without guestId yields welcome with no profile field (ephemeral)", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });

    const welcome = await stream.waitForType("welcome");
    expect(welcome.profile).toBeUndefined();
    expect(welcome.driverId).toBeDefined();
  });
});

describe("WS protocol: end-to-end lobby → race → progression (Phase 3+4 pipeline)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("hello(guestId) → lobby match → race to finish → progression with non-zero xp", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    const guestId = `gid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO, guestId });

    const welcome = await stream.waitForType("welcome");
    expect(welcome.profile).toBeDefined();
    await stream.waitForType("snapshot");

    const room = Array.from(handle!.rooms.values()).find((r) =>
      r.testHasDriverId(welcome.driverId as string),
    ) as Room;
    room.__advanceForTest();

    const prog = await stream.waitForType("progression", 8000);
    expect(prog.xpGained).toBeGreaterThan(0);
    expect(prog.level).toBeGreaterThanOrEqual(1);
    expect(prog.racesCount).toBe(1);
    expect(prog.division).toBe("F4");
  });
});
