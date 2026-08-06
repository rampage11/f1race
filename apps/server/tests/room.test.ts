import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import type { PilotProfile } from "@f1race/race-engine";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import type { ServerMessage } from "../src/protocol.js";
import { Room, type RoomSink } from "../src/room.js";
import type { ServerHandle } from "../src/server.js";
import {
  resolveEffectiveReactionSec,
  START_JUMP_START_REACTION_SEC,
  START_LATE_REACTION_SEC,
  START_SEQUENCE_DELAY_MS,
} from "../src/start-sequence.js";
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

async function waitForRoomState(stream: MsgStream, playerCount: number, timeoutMs = 3000): Promise<{
  type: "roomState";
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
      return msg as { type: "roomState"; players: { driverId: string; name: string; connected: boolean }[] };
    }
  }
}

describe("Room (unit): driverId ownership & join model", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  it("assigns distinct driverIds per connection and enforces ownership", () => {
    const room = new Room();
    const sinkA = makeSink();
    const sinkB = makeSink();

    const idA = room.addConnection("conn-a", sinkA, HERO_A);
    const idB = room.addConnection("conn-b", sinkB, HERO_B);

    expect(typeof idA).toBe("string");
    expect(typeof idB).toBe("string");
    expect(idA).not.toBe(idB);

    expect(room.ownsDriver("conn-a", idA)).toBe(true);
    expect(room.ownsDriver("conn-a", idB)).toBe(false);
    expect(room.ownsDriver("conn-b", idB)).toBe(true);
    expect(room.ownsDriver("conn-b", idA)).toBe(false);
    expect(room.ownsDriver("conn-unknown", idA)).toBe(false);

    room.stop();
  });

  it("each connection receives a snapshot personalized with its own heroId", () => {
    const room = new Room();
    const sinkA = makeSink();
    const sinkB = makeSink();

    const idA = room.addConnection("conn-a", sinkA, HERO_A);
    const idB = room.addConnection("conn-b", sinkB, HERO_B);

    const lastSnapA = [...sinkA.messages].reverse().find((m) => m.type === "snapshot");
    const lastSnapB = [...sinkB.messages].reverse().find((m) => m.type === "snapshot");

    expect(lastSnapA).toBeDefined();
    expect(lastSnapB).toBeDefined();
    expect((lastSnapA as { heroId: string }).heroId).toBe(idA);
    expect((lastSnapB as { heroId: string }).heroId).toBe(idB);

    room.stop();
  });

  it("canJoin is true while in qualy with a free slot", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    expect(room.canJoin()).toBe(true);
    expect(room.connectionCount).toBe(1);
    expect(room.activeConnectionCount).toBe(1);
    room.stop();
  });
});

describe("Room (integration): multi-client broadcast", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("two clients land in the same room, both receive snapshots with distinct heroIds", async () => {
    const ws1 = await connectClient(handle!.port);
    const ws2 = await connectClient(handle!.port);
    clients.push(ws1, ws2);
    const stream1 = new MsgStream(ws1);
    const stream2 = new MsgStream(ws2);

    // Send both hellos back-to-back so the lobby groups them into the same room.
    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });

    await stream1.waitForType("stage");
    const firstSnap = await stream1.waitForType("snapshot");
    const heroId1 = firstSnap.heroId as string;

    await stream2.waitForType("stage");
    const snap2 = await stream2.waitForType("snapshot");
    const heroId2 = snap2.heroId as string;

    expect(heroId1).not.toBe(heroId2);
    expect(heroId1.length).toBeGreaterThan(0);
    expect(heroId2.length).toBeGreaterThan(0);

    await waitForRoomState(stream1, 2);
    await waitForRoomState(stream2, 2);

    const recent1 = await stream1.waitForType("snapshot");
    const recent2 = await stream2.waitForType("snapshot");

    expect(recent1.heroId).toBe(heroId1);
    expect(recent2.heroId).toBe(heroId2);

    expect(recent1.snapshot.cars).toHaveLength(20);
    expect(recent2.snapshot.cars).toHaveLength(20);

    const driverIds1 = recent1.snapshot.cars.map((c: { driverId: string }) => c.driverId);
    expect(driverIds1).toContain(heroId1);
    expect(driverIds1).toContain(heroId2);

    const humans1 = recent1.snapshot.cars.filter((c: { kind: string }) => c.kind === "human");
    expect(humans1).toHaveLength(2);
    expect(humans1.map((c: { driverId: string }) => c.driverId).sort()).toEqual([heroId1, heroId2].sort());

    const humans2 = recent2.snapshot.cars.filter((c: { kind: string }) => c.kind === "human");
    expect(humans2).toHaveLength(2);
  });

  it("roomState lists both players as connected after join", async () => {
    const ws1 = await connectClient(handle!.port);
    const ws2 = await connectClient(handle!.port);
    clients.push(ws1, ws2);
    const stream1 = new MsgStream(ws1);
    const stream2 = new MsgStream(ws2);

    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });
    await stream1.waitForType("snapshot");
    await stream2.waitForType("snapshot");

    const state1 = await waitForRoomState(stream1, 2);
    const state2 = await waitForRoomState(stream2, 2);

    expect(state1.players.map((p) => p.name).sort()).toEqual(["Hero Alpha", "Hero Beta"]);
    expect(state1.players.every((p) => p.connected)).toBe(true);
    expect(state2.players.every((p) => p.connected)).toBe(true);
  });
});

describe("Room (integration): disconnect & ownership isolation", () => {
  let clients: WebSocket[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => closeClient(c)));
    clients = [];
  });

  it("when one client disconnects, the room continues for the other and roomState marks the leaver", async () => {
    const ws1 = await connectClient(handle!.port);
    const ws2 = await connectClient(handle!.port);
    clients.push(ws1, ws2);
    const stream1 = new MsgStream(ws1);
    const stream2 = new MsgStream(ws2);

    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });
    await stream1.waitForType("snapshot");
    await stream2.waitForType("snapshot");
    await waitForRoomState(stream1, 2);

    await closeClient(ws2);
    clients = [ws1];

    const state = await waitForRoomState(stream1, 2);
    const byConnected = new Map(state.players.map((p) => [p.connected, p]));
    expect(byConnected.size).toBe(2);
    expect(byConnected.get(true)?.name).toBe("Hero Alpha");
    expect(byConnected.get(false)?.name).toBe("Hero Beta");

    const snap = await stream1.waitForType("snapshot", 2000);
    expect(snap.snapshot.cars).toHaveLength(20);
    expect(snap.heroId.length).toBeGreaterThan(0);
  });

  it("a pit command from one client never targets the other client's driver (ownership by binding)", async () => {
    const ws1 = await connectClient(handle!.port);
    const ws2 = await connectClient(handle!.port);
    clients.push(ws1, ws2);
    const stream1 = new MsgStream(ws1);
    const stream2 = new MsgStream(ws2);

    send(ws1, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_A });
    send(ws2, { type: "hello", protocolVersion: PROTOCOL_VERSION, hero: HERO_B });
    const snap1 = await stream1.waitForType("snapshot");
    const heroId1 = snap1.heroId as string;
    const snap2 = await stream2.waitForType("snapshot");
    const heroId2 = snap2.heroId as string;

    await waitForRoomState(stream1, 2);
    expect(heroId1).not.toBe(heroId2);

    send(ws2, { type: "pit", compound: "hard" });

    const snap2after = await stream2.waitForType("snapshot", 2000);
    expect(snap2after.type).toBe("snapshot");
    expect(snap2after.heroId).toBe(heroId2);

    const recent = await stream1.waitForType("snapshot", 2000);
    expect(recent.heroId).toBe(heroId1);
    expect(recent.snapshot.cars).toHaveLength(20);
    const driverIds = recent.snapshot.cars.map((c: { driverId: string }) => c.driverId);
    expect(driverIds).toContain(heroId1);
    expect(driverIds).toContain(heroId2);
  });
});

describe("start sequence: resolveEffectiveReactionSec (pure helper, spec P2)", () => {
  const opts = { jumpStartPenaltySec: 2.0, minReactionSec: 0.05, maxReactionSec: 1.5 };
  const lightsOutAt = 1_000_000;

  it("normal reaction after lights out is measured against the server clock", () => {
    const r = resolveEffectiveReactionSec(lightsOutAt + 250, lightsOutAt, opts);
    expect(r.jumpStart).toBe(false);
    expect(r.reactionSec).toBeCloseTo(0.25, 5);
  });

  it("a click received before lights out is a jump start with a fixed penalty", () => {
    const r = resolveEffectiveReactionSec(lightsOutAt - 500, lightsOutAt, opts);
    expect(r.jumpStart).toBe(true);
    expect(r.reactionSec).toBe(opts.jumpStartPenaltySec);
  });

  it("a sub-100ms human reaction is accepted (not flagged as a jump start)", () => {
    const r = resolveEffectiveReactionSec(lightsOutAt + 80, lightsOutAt, opts);
    expect(r.jumpStart).toBe(false);
    expect(r.reactionSec).toBeCloseTo(0.08, 5);
  });

  it("clamps a near-zero positive delta to the floor", () => {
    const r = resolveEffectiveReactionSec(lightsOutAt + 10, lightsOutAt, opts);
    expect(r.jumpStart).toBe(false);
    expect(r.reactionSec).toBe(opts.minReactionSec);
  });

  it("clamps an absurdly slow valid reaction to the ceiling", () => {
    const r = resolveEffectiveReactionSec(lightsOutAt + 6000, lightsOutAt, opts);
    expect(r.jumpStart).toBe(false);
    expect(r.reactionSec).toBe(opts.maxReactionSec);
  });

  it("a click exactly at lights out is not a jump start (floor-clamped)", () => {
    const r = resolveEffectiveReactionSec(lightsOutAt, lightsOutAt, opts);
    expect(r.jumpStart).toBe(false);
    expect(r.reactionSec).toBe(opts.minReactionSec);
  });
});

describe("Room (unit): lights-out start sequence (spec P2 / Phase 2)", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  it("broadcasts startSequence with sequenceId 1 and a future lightsOutAt", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    const before = Date.now();
    room.beginStartSequenceForTest();
    const seq = sink.messages.find((m) => m.type === "startSequence") as
      | { type: "startSequence"; lightsOutAt: number; sequenceId: number }
      | undefined;
    expect(seq).toBeDefined();
    expect(seq!.sequenceId).toBe(1);
    expect(seq!.lightsOutAt).toBeGreaterThanOrEqual(before + START_SEQUENCE_DELAY_MS - 50);
    expect(room.currentStage).toBe("startSequence");
    room.stop();
  });

  it("a jump start (click before lights out) applies the penalty and resolves early in solo", () => {
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO_A);
    room.beginStartSequenceForTest();
    const seq = sink.messages.find((m) => m.type === "startSequence") as
      | { type: "startSequence"; sequenceId: number }
      | undefined;
    // React immediately — lightsOutAt is ~6s in the future, so this is a jump start.
    const err = room.recordStartReaction("conn-a", Date.now(), seq!.sequenceId);
    expect(err).toBeNull();
    // Solo + last human reacted => early resolution.
    expect(room.currentStage).toBe("race");
    expect(room.testGetDriverReactionSec(driverId)).toBe(START_JUMP_START_REACTION_SEC);
    const res = sink.messages.find((m) => m.type === "startResult") as
      | { type: "startResult"; reactionSec: number; jumpStart: boolean }
      | undefined;
    expect(res).toBeDefined();
    expect(res!.jumpStart).toBe(true);
    expect(res!.reactionSec).toBe(START_JUMP_START_REACTION_SEC);
    room.stop();
  });

  it("a normal post-lights-out reaction is measured and applied", () => {
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO_A);
    // Lights already out ~400ms ago => a near-immediate click is a legit ~0.4s reaction.
    room.beginStartSequenceForTest({ delayMs: -400 });
    const seq = sink.messages.find((m) => m.type === "startSequence") as
      | { type: "startSequence"; sequenceId: number }
      | undefined;
    room.recordStartReaction("conn-a", Date.now(), seq!.sequenceId);
    const sec = room.testGetDriverReactionSec(driverId);
    expect(sec).not.toBeNull();
    expect(sec!).toBeGreaterThanOrEqual(0.39);
    expect(sec!).toBeLessThanOrEqual(0.6);
    expect(room.currentStage).toBe("race");
    room.stop();
  });

  it("assigns the late default when no reaction arrives within the window", () => {
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO_A);
    room.beginStartSequenceForTest();
    // No reaction — force the window-expiry resolution path.
    room.resolveStartSequenceForTest();
    expect(room.currentStage).toBe("race");
    expect(room.testGetDriverReactionSec(driverId)).toBe(START_LATE_REACTION_SEC);
    const res = sink.messages.find((m) => m.type === "startResult") as
      | { type: "startResult"; jumpStart: boolean }
      | undefined;
    expect(res).toBeDefined();
    expect(res!.jumpStart).toBe(false);
    room.stop();
  });

  it("rejects a startReaction outside the start sequence (P17 — no silent drop)", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    const err = room.recordStartReaction("conn-a", Date.now(), 1);
    expect(err).toMatch(/start reaction only available during the start sequence/);
    room.stop();
  });

  it("ignores a stale-sequence startReaction without resolving", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    room.beginStartSequenceForTest(); // sequenceId = 1
    const err = room.recordStartReaction("conn-a", Date.now(), 999);
    expect(err).toBeNull(); // stale clicks are silently ignored, not errored
    expect(room.currentStage).toBe("startSequence");
    room.stop();
  });

  it("multiplayer: waits for all humans before early-resolving", () => {
    const room = new Room();
    const sinkA = makeSink();
    const sinkB = makeSink();
    const idA = room.addConnection("conn-a", sinkA, HERO_A);
    const idB = room.addConnection("conn-b", sinkB, HERO_B);
    room.beginStartSequenceForTest();
    const seqA = sinkA.messages.find((m) => m.type === "startSequence") as
      | { type: "startSequence"; sequenceId: number }
      | undefined;
    // Only A reacts — sequence must NOT resolve yet (B still pending).
    room.recordStartReaction("conn-a", Date.now(), seqA!.sequenceId);
    expect(room.currentStage).toBe("startSequence");
    // B reacts -> all humans reacted -> resolves.
    room.recordStartReaction("conn-b", Date.now(), seqA!.sequenceId);
    expect(room.currentStage).toBe("race");
    expect(room.testGetDriverReactionSec(idA)).toBe(START_JUMP_START_REACTION_SEC);
    expect(room.testGetDriverReactionSec(idB)).toBe(START_JUMP_START_REACTION_SEC);
    room.stop();
  });

  it("restart cancels an in-flight sequence and bumps sequenceId on the next begin", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    room.beginStartSequenceForTest();
    expect(room.currentStage).toBe("startSequence");
    room.restart("conn-a");
    expect(room.currentStage).toBe("qualy");
    room.beginStartSequenceForTest();
    const seqs = sink.messages.filter((m) => m.type === "startSequence") as
      | { type: "startSequence"; sequenceId: number }[];
    const lastSeq = seqs[seqs.length - 1];
    expect(lastSeq).toBeDefined();
    expect(lastSeq!.sequenceId).toBe(2);
    room.stop();
  });

  it("bots keep their factory reactionTimeSec (only humans are measured)", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    room.beginStartSequenceForTest();
    room.resolveStartSequenceForTest();
    expect(room.currentStage).toBe("race");
    // The 19 bots must have retained their randomly-assigned reaction, not the late default
    // that humans get when they fail to react.
    const botSecs = room.testGetBotReactionSecs();
    expect(botSecs).toHaveLength(19);
    for (const s of botSecs) {
      expect(s).not.toBe(START_LATE_REACTION_SEC);
      expect(s).toBeGreaterThan(0);
    }
    room.stop();
  });
});
