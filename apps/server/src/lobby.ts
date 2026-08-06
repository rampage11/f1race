import { divisionForLevel, levelFromXp } from "@f1race/race-engine";
import type { PilotProfile } from "@f1race/race-engine";
import type { Division, ServerMessage } from "./protocol.js";
import type { Room, RoomSink, ConnectionId } from "./room.js";
import type { DriverProfile } from "./persistence/repository.js";

const FIELD_SIZE = 20;
const DIVISIONS: Division[] = ["F4", "F3", "F2", "F1"];

export interface QueueEntry {
  connectionId: ConnectionId;
  sink: RoomSink;
  guestId: string | null;
  hero: PilotProfile;
  savedProfile: DriverProfile | null;
  division: Division;
  enqueuedAt: number;
}

function envMs(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

export function divisionOf(profile: DriverProfile | null): Division {
  return divisionForLevel(levelFromXp(profile?.totalXp ?? 0));
}

export class Lobby {
  private queue: QueueEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  // tuning constants (spec Фаза 4: matchmaking tick 30s, division split, bot backfill).
  // Overridable via env so tests can shrink them.
  private readonly tickMs: number;
  private readonly soloWaitMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private createRoom: () => Room,
    private onMatched: (connectionId: ConnectionId, room: Room) => void,
  ) {
    this.tickMs = envMs("MATCH_TICK_MS", 30000);
    this.soloWaitMs = envMs("SOLO_WAIT_MS", 2000);
    this.maxWaitMs = envMs("MAX_WAIT_MS", 60000);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickMatch(), this.tickMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  enqueue(entry: QueueEntry): void {
    this.queue.push(entry);
    this.sendLobbyState(entry);
    // Immediate placement pass: only GROUPS same-division humans (>=2) so a second player
    // joining lands both in a room instantly. Solo fast-start is left to the tick — running
    // it here would solo a lone player before a same-division partner can enqueue.
    this.tryGroupSameDivision();
  }

  dequeue(connectionId: ConnectionId): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((e) => e.connectionId !== connectionId);
    if (this.queue.length !== before) this.broadcastLobbyState();
  }

  // Group-only pass: if any division bucket has >=2 humans, form room(s) and assign.
  private tryGroupSameDivision(): void {
    if (this.queue.length < 2) return;
    const now = Date.now();
    const flexible: QueueEntry[] = [];
    const buckets = new Map<Division, QueueEntry[]>();
    for (const e of this.queue) {
      if (now - e.enqueuedAt >= this.maxWaitMs) flexible.push(e);
      else {
        const b = buckets.get(e.division) ?? [];
        b.push(e);
        buckets.set(e.division, b);
      }
    }
    const matched = new Set<ConnectionId>();
    const groups: QueueEntry[][] = [];
    for (const d of DIVISIONS) {
      const bucket = buckets.get(d);
      if (!bucket || bucket.length < 2) continue;
      for (const e of bucket) matched.add(e.connectionId);
      for (let i = 0; i < bucket.length; i += FIELD_SIZE) {
        groups.push(bucket.slice(i, i + FIELD_SIZE));
      }
    }
    if (groups.length === 0 && flexible.length < 2) return;
    if (flexible.length >= 2) {
      for (const e of flexible) matched.add(e.connectionId);
      for (let i = 0; i < flexible.length; i += FIELD_SIZE) {
        groups.push(flexible.slice(i, i + FIELD_SIZE));
      }
    }
    if (groups.length === 0) return;
    this.queue = this.queue.filter((e) => !matched.has(e.connectionId));
    for (const group of groups) this.formRoom(group);
    this.broadcastLobbyState();
  }

  // Full pass run on each tick: group same-division, solo fast-start, widener.
  private tickMatch(): void {
    if (this.queue.length === 0) return;
    const now = Date.now();
    const flexible: QueueEntry[] = [];
    const buckets = new Map<Division, QueueEntry[]>();
    for (const e of this.queue) {
      if (now - e.enqueuedAt >= this.maxWaitMs) flexible.push(e);
      else {
        const b = buckets.get(e.division) ?? [];
        b.push(e);
        buckets.set(e.division, b);
      }
    }
    const matched = new Set<ConnectionId>();
    const groups: QueueEntry[][] = [];
    for (const d of DIVISIONS) {
      const bucket = buckets.get(d);
      if (!bucket || bucket.length === 0) continue;
      // Form a room when the bucket has company (>=2) OR a lone player has hit soloWaitMs.
      const anySoloReady = bucket.some((e) => now - e.enqueuedAt >= this.soloWaitMs);
      if (bucket.length >= 2 || anySoloReady) {
        for (const e of bucket) matched.add(e.connectionId);
        for (let i = 0; i < bucket.length; i += FIELD_SIZE) {
          groups.push(bucket.slice(i, i + FIELD_SIZE));
        }
      }
    }
    // Widener: players past maxWaitMs match into ANY division. Form a cross-division room
    // from the flexible pool so nobody waits forever (documented widener behaviour).
    if (flexible.length > 0) {
      for (const e of flexible) matched.add(e.connectionId);
      for (let i = 0; i < flexible.length; i += FIELD_SIZE) {
        groups.push(flexible.slice(i, i + FIELD_SIZE));
      }
    }
    if (groups.length === 0) return;
    this.queue = this.queue.filter((e) => !matched.has(e.connectionId));
    for (const group of groups) this.formRoom(group);
    this.broadcastLobbyState();
  }

  private formRoom(group: QueueEntry[]): void {
    const room = this.createRoom();
    for (const e of group) {
      room.addConnection(
        e.connectionId,
        e.sink,
        e.hero,
        e.guestId ?? undefined,
        { hero: e.hero, guestId: e.guestId, profile: e.savedProfile },
      );
      this.onMatched(e.connectionId, room);
    }
  }

  private sendLobbyState(entry: QueueEntry): void {
    if (!entry.sink.isOpen()) return;
    const same = this.queue.filter((e) => e.division === entry.division).length;
    const estimated = this.estimateWaitSec(entry);
    const msg: ServerMessage = {
      type: "lobbyState",
      division: entry.division,
      queuedPlayers: same,
      estimatedWaitSec: estimated,
    };
    entry.sink.send(msg);
  }

  private broadcastLobbyState(): void {
    for (const e of this.queue) this.sendLobbyState(e);
  }

  private estimateWaitSec(entry: QueueEntry): number {
    const same = this.queue.filter((e) => e.division === entry.division).length;
    if (same >= 2) return Math.ceil(this.tickMs / 1000);
    return Math.ceil(this.soloWaitMs / 1000);
  }
}
