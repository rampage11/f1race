import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { PilotProfile } from "@f1race/race-engine";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import type { ServerHandle } from "../src/server.js";
import { closeClient, connectClient, launchServer, MsgStream, send } from "./helpers.js";

const HERO_A: PilotProfile = {
  name: "Hero Alpha",
  country: "AT",
  team: "Redmine",
  skills: { fitness: 5, reaction: 5, attack: 5, defense: 5, pace: 5, tyreMgmt: 5 },
  startingTyre: "medium",
  pitCompound: "soft",
};

const HERO_B: PilotProfile = {
  name: "Hero Beta",
  country: "JP",
  team: "Crimson",
  skills: { fitness: 4, reaction: 6, attack: 5, defense: 4, pace: 6, tyreMgmt: 4 },
  startingTyre: "soft",
  pitCompound: "medium",
};

let handle: ServerHandle | null = null;
let prevDbPath: string | undefined;

beforeAll(async () => {
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

async function waitForRoomState(stream: MsgStream, playerCount: number, timeoutMs = 3000): Promise<void> {
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
      return;
    }
  }
}

describe("Lobby matchmaking (Phase 4)", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("two same-division (F4) clients are matched into the same room", async () => {
    const ws1 = await connectClient(handle!.port);
    const ws2 = await connectClient(handle!.port);
    clients.push(ws1, ws2);
    const stream1 = new MsgStream(ws1);
    const stream2 = new MsgStream(ws2);

    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });

    const welcome1 = await stream1.waitForType("welcome");
    const welcome2 = await stream2.waitForType("welcome");

    // Wait until roomState confirms both humans are in the room before reading a snapshot —
    // the first snapshot each client receives is emitted during its own addConnection, before
    // the partner is wired in, so an early read would show only one human.
    await waitForRoomState(stream1, 2);
    await waitForRoomState(stream2, 2);

    const snap1 = await stream1.waitForType("snapshot");
    const snap2 = await stream2.waitForType("snapshot");

    const cars1 = snap1.snapshot.cars as { driverId: string; kind: string }[];
    const humans1 = cars1.filter((c) => c.kind === "human");
    expect(humans1).toHaveLength(2);
    expect(humans1.map((c) => c.driverId).sort()).toEqual(
      [welcome1.driverId, welcome2.driverId].sort(),
    );
    const humans2 = (snap2.snapshot.cars as { driverId: string; kind: string }[]).filter(
      (c) => c.kind === "human",
    );
    expect(humans2).toHaveLength(2);
  });

  it("a lone player is solo-matched into a bot-filled room within ~one tick", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);

    const start = Date.now();
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });

    const lobby = await stream.waitForType("lobbyState");
    expect(lobby.division).toBe("F4");
    const welcome = await stream.waitForType("welcome");
    const elapsed = Date.now() - start;
    // Solo fast-start fires on the first tick; with MATCH_TICK_MS=50 this is well under 1s.
    expect(elapsed).toBeLessThan(1000);

    const snap = await stream.waitForType("snapshot");
    const humans = (snap.snapshot.cars as { kind: string }[]).filter((c) => c.kind === "human");
    expect(humans).toHaveLength(1);
    // 19 bots backfill the field to 20.
    expect(snap.snapshot.cars).toHaveLength(20);
  });

  it("lobbyState is received before welcome", async () => {
    const ws = await connectClient(handle!.port);
    clients.push(ws);
    const stream = new MsgStream(ws);
    send(ws, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });

    const first = await stream.next();
    expect(first.type).toBe("lobbyState");
    const second = await stream.waitForType("welcome");
    expect(second.type).toBe("welcome");
  });

  it("a client that disconnects while queued is removed (no ghost slot)", async () => {
    const ws1 = await connectClient(handle!.port);
    clients.push(ws1);
    const stream1 = new MsgStream(ws1);
    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });
    await stream1.waitForType("lobbyState");

    // Disconnect before matching: the lobby must dequeue this player.
    await closeClient(ws1);
    clients = [];

    // Give the server a moment to process the close + dequeue.
    await new Promise((r) => setTimeout(r, 60));

    // A fresh player should match solo and be the only human in their room.
    const ws2 = await connectClient(handle!.port);
    clients.push(ws2);
    const stream2 = new MsgStream(ws2);
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });
    const welcome2 = await stream2.waitForType("welcome");
    const snap = await stream2.waitForType("snapshot");
    const humans = (snap.snapshot.cars as { kind: string; driverId: string }[]).filter(
      (c) => c.kind === "human",
    );
    expect(humans).toHaveLength(1);
    expect(humans[0]!.driverId).toBe(welcome2.driverId);
  });
});
