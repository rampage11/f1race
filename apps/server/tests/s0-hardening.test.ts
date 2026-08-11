import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { WebSocket } from "ws";
import type { PilotProfile } from "@f1race/race-engine";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import type { ServerHandle } from "../src/server.js";
import { Room, type RoomSink } from "../src/room.js";
import type { ServerMessage } from "../src/protocol.js";
import { createRepository, type DriverProfileRepository } from "../src/persistence/index.js";
import { closeClient, connectClient, launchServer, MsgStream, send } from "./helpers.js";

const HERO: PilotProfile = {
  name: "S0 Hero",
  country: "AT",
  team: "Redline",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

let handle: ServerHandle | null = null;
let repo: DriverProfileRepository;
let dir: string;
let dbPath: string;
let prevEnv: Record<string, string | undefined>;

beforeAll(async () => {
  prevEnv = { DB_PATH: process.env.DB_PATH };
  dir = mkdtempSync(join(tmpdir(), "f1race-s0-"));
  dbPath = join(dir, "s0.db");
  process.env.DB_PATH = dbPath;
  handle = await launchServer();
  repo = createRepository(dbPath);
});

afterAll(async () => {
  if (handle) {
    await handle.stop();
    handle = null;
  }
  repo.close();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------
// S0-1: WS hello / startTutorial hero validation (anti-cheat)
// ---------------------------------------------------------------------------------------

describe("S0-1: WS hello hero validation (anti-cheat)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("hello with a non-object hero is rejected (shape check)", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: "not-an-object" });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/некорректный профиль пилота/);
  });

  it("hello with a hero missing required string fields is rejected (shape check)", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      hero: { ...HERO, team: 123 },
    });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/некорректный профиль пилота/);
  });

  it("hello with oversized skills (pace: 999) is rejected — no god-mode", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    const guestId = `cheat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const godHero: PilotProfile = {
      ...HERO,
      skills: { fitness: 99, reaction: 99, attack: 99, defense: 99, pace: 999, tyreMgmt: 99 },
    };
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: godHero, guestId });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/некорректный профиль пилота/);

    // Drain anything the server sends for a moment and confirm no welcome arrives — the
    // hello was rejected, so no room was built and no driver was registered for this player.
    let sawWelcome = false;
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      try {
        const m = await stream.next(150);
        if (m && (m as { type?: string }).type === "welcome") sawWelcome = true;
      } catch {
        break;
      }
    }
    expect(sawWelcome).toBe(false);
  });

  it("hello with a non-10-point starting allocation is rejected for a new pilot", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    const badHero: PilotProfile = {
      ...HERO,
      skills: { fitness: 5, reaction: 5, attack: 5, defense: 5, pace: 5, tyreMgmt: 5 },
    };
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: badHero });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/некорректный профиль пилота/);
  });

  it("a confirmed profile's skills cannot be overwritten via hello (server owns skills)", async () => {
    // Seed a confirmed profile directly into the shared SQLite file. The server (same DB)
    // will see it on the next hello. Then send a hello carrying god-mode skills on the same
    // guestId — the server MUST accept the hello (it's a confirmed pilot reconnecting) but
    // MUST NOT store the client-supplied skills.
    const guestId = `confirmed-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const originalHero: PilotProfile = {
      name: "Seeded",
      country: "RU",
      team: "Academy",
      skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
      startingTyre: "medium",
      pitCompound: "soft",
    };
    const now = Date.now();
    repo.upsert({
      guestId,
      hero: originalHero,
      totalXp: 0,
      racesCount: 0,
      heroConfirmed: true,
      createdAt: now,
      updatedAt: now,
    });

    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    const godHero: PilotProfile = {
      ...originalHero,
      skills: { fitness: 99, reaction: 99, attack: 99, defense: 99, pace: 999, tyreMgmt: 99 },
    };
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: godHero, guestId });

    // Hello must succeed for a confirmed pilot (we don't want to lock them out), and the
    // welcome must carry the SERVER-OWNED skills, not the client's god-mode values.
    const welcome = await stream.waitForType("welcome");
    expect(welcome.profile).toBeDefined();
    expect(welcome.profile.hero.skills.pace).toBe(3);
    expect(welcome.profile.hero.skills.fitness).toBe(1);

    // The persisted row must also keep the original skills — no god-mode leak through
    // resolveHeroProfile's defense-in-depth branch.
    const after = repo.get(guestId);
    expect(after).not.toBeNull();
    expect(after!.hero.skills.pace).toBe(3);
    expect(after!.hero.skills.fitness).toBe(1);

    await closeClient(ws);
    clients = [];
  });
});

describe("S0-1: WS startTutorial hero validation", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("startTutorial with an invalid hero is rejected (shape check)", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "startTutorial", hero: { ...HERO, skills: "bad" as unknown } });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/некорректный профиль пилота/);
  });

  it("startTutorial with oversized skills is rejected — no god-mode in tutorial either", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    const godHero: PilotProfile = {
      ...HERO,
      skills: { fitness: 99, reaction: 99, attack: 99, defense: 99, pace: 999, tyreMgmt: 99 },
    };
    send(ws, { type: "startTutorial", hero: godHero });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/некорректный профиль пилота/);
  });

  it("startTutorial is rejected when the profile has already finished one", async () => {
    const guestId = `tutdone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    repo.upsert({
      guestId,
      hero: HERO,
      totalXp: 0,
      racesCount: 0,
      heroConfirmed: false,
      tutorialCompleted: true,
      createdAt: now,
      updatedAt: now,
    });

    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "startTutorial", hero: HERO, guestId });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/tutorial already completed/);
  });
});

// ---------------------------------------------------------------------------------------
// S0-2: runtime-validate pit compound + hammer mode (crash)
// ---------------------------------------------------------------------------------------

describe("S0-2: pit compound + hammer mode validation (crash guard)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  async function reachRace(): Promise<{ ws: WebSocket; stream: MsgStream; heroId: string }> {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    const welcome = await stream.waitForType("welcome");
    const heroId = welcome.driverId as string;
    await stream.waitForType("snapshot");
    const room = Array.from(handle!.rooms.values()).find((r) => r.testHasDriverId(heroId)) as Room;
    room.__advanceForTest({ stopAtRace: true });
    await stream.waitForType("snapshot", 3000);
    return { ws, stream, heroId };
  }

  it("pit with an invalid compound returns an error and the race keeps advancing", async () => {
    const { ws, stream, heroId } = await reachRace();
    send(ws, { type: "pit", compound: "HACK" });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/invalid tyre compound/);

    const snap = await stream.waitForType("snapshot", 1500);
    expect(snap.stage).toBe("race");
    expect(snap.snapshot.cars.some((c: { driverId: string }) => c.driverId === heroId)).toBe(true);
  });

  it("hammerTime with an invalid mode returns an error and the race keeps advancing", async () => {
    const { ws, stream } = await reachRace();
    send(ws, { type: "hammerTime", mode: "X" });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/invalid hammer mode/);

    const snap = await stream.waitForType("snapshot", 1500);
    expect(snap.stage).toBe("race");
  });

  it("valid compounds are NOT rejected on the compound-shape guard", () => {
    function makeSink(): RoomSink & { messages: ServerMessage[] } {
      const messages: ServerMessage[] = [];
      return { messages, send: (m) => messages.push(m), isOpen: () => true };
    }
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO);
    room.__advanceForTest({ stopAtRace: true });
    for (const c of ["soft", "medium", "hard", "intermediate", "wet"] as const) {
      const err = room.requestPit("conn-a", c);
      // A non-null error here is fine (rate-limit, queue outcome) — but it must NEVER be the
      // "invalid tyre compound" guard, which would mean a valid compound was rejected.
      expect(err !== "invalid tyre compound").toBe(true);
    }
    room.stop();
  });

  it("valid hammer modes are NOT rejected on the mode-shape guard", () => {
    function makeSink(): RoomSink & { messages: ServerMessage[] } {
      const messages: ServerMessage[] = [];
      return { messages, send: (m) => messages.push(m), isOpen: () => true };
    }
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO);
    room.__advanceForTest({ stopAtRace: true });
    room.__stepUntilLapForTest(driverId, 2);
    for (const m of ["attack", "defend", "push"] as const) {
      // Only the first call activates; subsequent ones hit cooldown — but NONE should match
      // the "invalid hammer mode" guard.
      const err = room.requestHammer("conn-a", m);
      expect(err !== "invalid hammer mode").toBe(true);
    }
    room.stop();
  });
});

// ---------------------------------------------------------------------------------------
// S0-3: type-validate speed value (NaN soft-brick)
// ---------------------------------------------------------------------------------------

describe("S0-3: speed value type validation (NaN guard)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  async function reachQualy(): Promise<{ ws: WebSocket; stream: MsgStream }> {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO });
    await stream.waitForType("snapshot");
    return { ws, stream };
  }

  it("speed with a string value returns an error", async () => {
    const { ws, stream } = await reachQualy();
    send(ws, { type: "speed", value: "abc" });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/invalid speed/);
  });

  it("speed with null returns an error", async () => {
    const { ws, stream } = await reachQualy();
    send(ws, { type: "speed", value: null });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/invalid speed/);
  });

  it("speed with NaN returns an error", async () => {
    const { ws, stream } = await reachQualy();
    send(ws, { type: "speed", value: NaN });

    const err = await stream.waitForType("error");
    expect(err.message).toMatch(/invalid speed/);
  });

  it("unit: setSpeed rejects bad types and still accepts a valid value afterwards", () => {
    function makeSink(): RoomSink & { messages: ServerMessage[] } {
      const messages: ServerMessage[] = [];
      return { messages, send: (m) => messages.push(m), isOpen: () => true };
    }
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO);
    room.__advanceForTest({ stopAtRace: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(room.setSpeed("conn-a", "abc" as any)).toMatch(/invalid speed/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(room.setSpeed("conn-a", null as any)).toMatch(/invalid speed/);
    expect(room.setSpeed("conn-a", NaN)).toMatch(/invalid speed/);
    expect(room.setSpeed("conn-a", Infinity)).toMatch(/invalid speed/);
    // After the rejections the room's `speed` is still a sane number — a valid speed still applies.
    expect(room.setSpeed("conn-a", 6)).toBeNull();
    room.stop();
  });
});

// ---------------------------------------------------------------------------------------
// S0-4: graceful shutdown — stop() idempotency
// ---------------------------------------------------------------------------------------

describe("S0-4: stop() idempotency (graceful shutdown)", () => {
  it("Room.stop() called twice does not throw", () => {
    function makeSink(): RoomSink & { messages: ServerMessage[] } {
      const messages: ServerMessage[] = [];
      return { messages, send: (m) => messages.push(m), isOpen: () => true };
    }
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO);
    room.stop();
    expect(() => room.stop()).not.toThrow();
  });

  it("ServerHandle.stop() is idempotent (second call resolves without throwing)", async () => {
    const local = await launchServer();
    await local.stop();
    await expect(local.stop()).resolves.toBeUndefined();
  });

  it("startServer registers signal handlers without breaking startup", async () => {
    const local = await launchServer();
    expect(typeof local.port).toBe("number");
    expect(local.port).toBeGreaterThan(0);
    expect(local.rooms).toBeInstanceOf(Map);
    await local.stop();
  });
});
