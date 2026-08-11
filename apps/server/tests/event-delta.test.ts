import { describe, expect, it } from "vitest";
import type { PilotProfile } from "@f1race/race-engine";
import type { ServerMessage } from "../src/protocol.js";
import { Room, type RoomSink } from "../src/room.js";

const HERO: PilotProfile = {
  name: "Hero",
  country: "RU",
  team: "Redstone",
  skills: { fitness: 2, reaction: 2, attack: 2, defense: 2, pace: 3, tyreMgmt: 2 },
  startingTyre: "medium",
  pitCompound: "soft",
};

interface RaceEventLike {
  seq: number;
  type: string;
}

interface RaceSnapLike {
  events: RaceEventLike[];
  eventSeq: number;
}

function raceSnapshots(msgs: ServerMessage[]): { snapshot: RaceSnapLike }[] {
  return msgs
    .filter((m) => m.type === "snapshot" && (m as { stage?: string }).stage === "race")
    .map((m) => m as { snapshot: RaceSnapLike });
}

describe("S1-5: delta-encoded snapshot events (server)", () => {
  function makeSink(): RoomSink & { messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];
    return { messages, send: (m) => messages.push(m), isOpen: () => true };
  }

  it("each client receives only previously-unseen events (no duplicate seqs; payload stays small)", () => {
    const room = new Room();
    const sink = makeSink();
    room.addConnection("conn-a", sink, HERO);
    room.__advanceForTest({ stopAtRace: true });

    // Drive the race forward through the production tick() path.
    let guard = 0;
    while (room.currentStage === "race" && guard++ < 5000) room.tick();

    const snaps = raceSnapshots(sink.messages);
    expect(snaps.length).toBeGreaterThan(1);

    // The very first race snapshot carries the race_start event (seq 1).
    const firstEvents = snaps[0]!.snapshot.events;
    expect(firstEvents.some((e) => e.type === "race_start")).toBe(true);

    // No event seq is ever delivered twice to the same client.
    const seenSeqs = new Set<number>();
    for (const s of snaps) {
      for (const e of s.snapshot.events) {
        expect(seenSeqs.has(e.seq)).toBe(false);
        seenSeqs.add(e.seq);
      }
    }
    expect(seenSeqs.size).toBeGreaterThan(1);

    // Delta encoding: after the initial burst, at least one tick delivers zero new events
    // (i.e. the per-tick payload is small, not the full growing event log).
    const emptyTicks = snaps.filter((s) => s.snapshot.events.length === 0).length;
    expect(emptyTicks).toBeGreaterThan(0);

    // The union of delivered seqs is a dense 1..max range with no gaps (monotonic counter).
    const maxSeq = Math.max(...seenSeqs);
    expect(seenSeqs.size).toBe(maxSeq);

    room.stop();
  });

  it("a reconnecting client receives no event backlog (events: [] on the first post-reconnect snapshot)", () => {
    const room = new Room();
    const sinkA = makeSink();
    room.addConnection("conn-a", sinkA, HERO);
    room.__advanceForTest({ stopAtRace: true });

    // Advance the race so events accumulate and conn-a's lastEventSeq moves past 0.
    let guard = 0;
    while (room.currentStage === "race" && guard++ < 50) room.tick();
    const aSnaps = raceSnapshots(sinkA.messages);
    expect(aSnaps.length).toBeGreaterThan(0);
    const lastEventSeq = aSnaps[aSnaps.length - 1]!.snapshot.eventSeq;
    expect(lastEventSeq).toBeGreaterThan(0);

    const welcome = sinkA.messages.find((m) => m.type === "welcome") as
      | { type: "welcome"; sessionToken: string }
      | undefined;
    expect(welcome).toBeDefined();
    const sessionToken = welcome!.sessionToken;

    // Drop conn-a, then rebind the same session to a fresh socket (sink-b).
    room.removeConnection("conn-a");
    const sinkB = makeSink();
    const result = room.reconnect("conn-b", sessionToken, sinkB);
    expect(result.ok).toBe(true);

    const bSnaps = raceSnapshots(sinkB.messages);
    expect(bSnaps.length).toBeGreaterThan(0);
    // Reconnect pinned lastEventSeq to the engine's current counter → no backlog is replayed.
    for (const s of bSnaps) {
      expect(s.snapshot.events).toEqual([]);
    }
    room.stop();
  });
});
