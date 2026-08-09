import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { TRACKS, type PilotProfile } from "@f1race/race-engine";
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

const TRACK_IDS = TRACKS.map((t) => t.id);
const WEATHER_VALUES = ["dry", "lightRain", "heavyRain", "variable"] as const;
const TOD_VALUES = ["day", "sunset", "night"] as const;
const START_CATEGORIES = ["perfect", "good", "slow", "verySlow", "jumpStart"] as const;

const HERO_A: PilotProfile = {
  name: "Hero Alpha",
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

describe("Room (unit): race forecast — track / weather / timeOfDay", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  it("welcome includes track (one of TRACKS) / weather / timeOfDay", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    const welcome = sink.messages.find((m) => m.type === "welcome") as
      | {
          type: "welcome";
          track?: { id: string; name: string; country: string; lengthM: number; laps: number };
          weather?: string;
          timeOfDay?: string;
        }
      | undefined;
    expect(welcome).toBeDefined();
    expect(welcome!.track).toBeDefined();
    expect(TRACK_IDS).toContain(welcome!.track!.id);
    expect(typeof welcome!.track!.name).toBe("string");
    expect(typeof welcome!.track!.country).toBe("string");
    expect(typeof welcome!.track!.lengthM).toBe("number");
    expect(welcome!.track!.laps).toBeGreaterThan(0);
    expect(WEATHER_VALUES).toContain(welcome!.weather);
    expect(TOD_VALUES).toContain(welcome!.timeOfDay);
    room.stop();
  });

  it("welcome forecast is also sent on reconnect", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    const welcome1 = sink.messages.find((m) => m.type === "welcome") as
      | { type: "welcome"; sessionToken: string }
      | undefined;
    const token = welcome1!.sessionToken;
    room.removeConnection("conn-a");

    const sink2 = makeSink();
    const result = room.reconnect("conn-b", token, sink2);
    expect(result.ok).toBe(true);
    const welcome2 = sink2.messages.find((m) => m.type === "welcome") as
      | {
          type: "welcome";
          track?: { id: string };
          weather?: string;
          timeOfDay?: string;
        }
      | undefined;
    expect(welcome2).toBeDefined();
    expect(welcome2!.track).toBeDefined();
    expect(TRACK_IDS).toContain(welcome2!.track!.id);
    expect(WEATHER_VALUES).toContain(welcome2!.weather);
    expect(TOD_VALUES).toContain(welcome2!.timeOfDay);
    room.stop();
  });
});

describe("Room (unit): hammer time (engine integration)", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  it("rejects hammerTime before race stage (qualy → 'hammer not available now')", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    expect(room.currentStage).toBe("qualy");
    const err = room.requestHammer("conn-a");
    expect(err).toMatch(/hammer not available now/);
    room.stop();
  });

  it("hammerTime is first-lap locked at race start ('hammer time locked on lap 1')", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    room.__advanceForTest({ stopAtRace: true });
    expect(room.currentStage).toBe("race");
    const err = room.requestHammer("conn-a");
    expect(err).toMatch(/hammer time locked on lap 1/);
    room.stop();
  });

  it("activates hammerTime past lap 1 (snapshot hammerTime.active === true; second immediate call is rate-limited)", () => {
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO_A);
    room.__advanceForTest({ stopAtRace: true });
    // Release the first-lap lock: step until the hero completes lap 1 (car.lap >= 2).
    room.__stepUntilLapForTest(driverId, 2);

    const err1 = room.requestHammer("conn-a");
    expect(err1).toBeNull();
    room.__emitSnapshotForTest();

    const raceSnap = [...sink.messages]
      .reverse()
      .find((m) => m.type === "snapshot" && (m as { stage?: string }).stage === "race") as
      | { snapshot: { cars: { driverId: string; hammerTime: { active: boolean } }[] } }
      | undefined;
    expect(raceSnap).toBeDefined();
    const hero = raceSnap!.snapshot.cars.find((c) => c.driverId === driverId);
    expect(hero).toBeDefined();
    expect(hero!.hammerTime.active).toBe(true);

    // Second call within the 300ms rate-limit window → rate-limited (not cooldown).
    const err2 = room.requestHammer("conn-a");
    expect(err2).toMatch(/rate limit: hammerTime/);
    room.stop();
  });

  it("after the rate-limit window passes, a second hammerTime is rejected as cooldown", async () => {
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO_A);
    room.__advanceForTest({ stopAtRace: true });
    room.__stepUntilLapForTest(driverId, 2);

    expect(room.requestHammer("conn-a")).toBeNull();
    // Wait past the 300ms rate limit; the engine cooldown (30s sim-time) is unaffected by
    // wall-clock waiting, so the next call must hit "rejected_cooldown".
    await new Promise((r) => setTimeout(r, 350));
    const err = room.requestHammer("conn-a");
    expect(err).toMatch(/hammer time on cooldown/);
    room.stop();
  });
});

describe("Room (unit): startResult carries a category (engine startCategory)", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  it("a normal post-lights-out reaction yields a startResult.category (one of the 5 enums)", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    // Lights already out ~400ms ago → a near-immediate click is a legit ~0.4s reaction.
    room.beginStartSequenceForTest({ delayMs: -400 });
    const seq = sink.messages.find((m) => m.type === "startSequence") as
      | { type: "startSequence"; sequenceId: number }
      | undefined;
    room.recordStartReaction("conn-a", Date.now(), seq!.sequenceId);

    const res = sink.messages.find((m) => m.type === "startResult") as
      | { type: "startResult"; category: string }
      | undefined;
    expect(res).toBeDefined();
    expect(START_CATEGORIES).toContain(res!.category);
    expect(res!.category).not.toBe("jumpStart");
    room.stop();
  });

  it("a jump start (click before lights out) yields startResult.category === 'jumpStart'", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    room.beginStartSequenceForTest(); // lightsOutAt ~6s in the future
    const seq = sink.messages.find((m) => m.type === "startSequence") as
      | { type: "startSequence"; sequenceId: number }
      | undefined;
    // Immediate click = jump start.
    room.recordStartReaction("conn-a", Date.now(), seq!.sequenceId);

    const res = sink.messages.find((m) => m.type === "startResult") as
      | { type: "startResult"; category: string; jumpStart: boolean }
      | undefined;
    expect(res).toBeDefined();
    expect(res!.jumpStart).toBe(true);
    expect(res!.category).toBe("jumpStart");
    room.stop();
  });
});

describe("Room (unit): pre-qualifying tyre selection (setStartingTyre)", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  it("a setStartingTyre during qualy overrides the hero driver's startingTyre on the race grid", () => {
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO_A);
    expect(room.currentStage).toBe("qualy");
    expect(HERO_A.startingTyre).toBe("medium");

    const err = room.requestSetStartingTyre("conn-a", "hard");
    expect(err).toBeNull();

    room.__advanceForTest({ stopAtRace: true });
    expect(room.currentStage).toBe("race");
    expect(room.testGetDriverStartingTyre(driverId)).toBe("hard");
    room.stop();
  });

  it("rejects setStartingTyre during the race stage ('tyre can only be chosen before the race')", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO_A);
    room.__advanceForTest({ stopAtRace: true });
    expect(room.currentStage).toBe("race");

    const err = room.requestSetStartingTyre("conn-a", "soft");
    expect(err).toMatch(/tyre can only be chosen before the race/);
    room.stop();
  });

  it("without a choice the hero driver keeps the profile startingTyre on the grid", () => {
    const room = new Room();
    const sink = makeSink();
    const driverId = room.addConnection("conn-a", sink, HERO_A);
    room.__advanceForTest({ stopAtRace: true });
    expect(room.testGetDriverStartingTyre(driverId)).toBe(HERO_A.startingTyre);
    room.stop();
  });
});
