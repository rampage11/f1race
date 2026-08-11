import { randomUUID } from "node:crypto";
import {
  CONFIG,
  QualifyingEngine,
  RaceEngine,
  buildQualyConfig,
  buildRaceConfig,
  divisionForRating,
  divisionIndex,
  driverRating,
  levelFromXp,
  levelUpPointsAccrued,
  makeBot,
  makeDriver,
  mulberry32,
  nextDriverId,
  randomTrack,
  recommendedLaps,
  skillSum,
  startCategory,
  xpForRace,
  STARTING_SKILL_POINTS,
  type Driver,
  type HammerMode,
  type PilotProfile,
  type PushStrategy,
  type RaceResult,
  type RaceResultRow,
  type RaceSnapshot,
  type Rng,
  type StartCategory,
  type TimeOfDay,
  type Track,
  type TyreCompound,
  type Weather,
} from "@f1race/race-engine";
import type { Division, RoomMode, RoomPlayer, ServerMessage, Stage } from "./protocol.js";
import type { DriverProfile, DriverProfileRepository } from "./persistence/repository.js";
import { pickDailyQuestIds } from "./quests.js";
import {
  DEFAULT_REACTION_OPTIONS,
  REACTION_WINDOW_MS,
  START_SEQUENCE_DELAY_MS,
  START_LATE_REACTION_SEC,
  resolveEffectiveReactionSec,
  randomStartDelayMs,
} from "./start-sequence.js";

const TICK_MS = 100;
const DT = 0.1;
const DEFAULT_SPEED = 6;
const FIELD_SIZE = 20;

// disconnected drivers keep their slot (and their car keeps simulating) for this
// long before eviction; after eviction the car remains in the race as an unowned ghost.
// Overridable via GRACE_PERIOD_MS env (used by tests).
const DEFAULT_GRACE_PERIOD_MS = 30000;
function gracePeriodMs(): number {
  const v = Number(process.env.GRACE_PERIOD_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GRACE_PERIOD_MS;
}

// min ms between accepted commands of the same type, per connection (spec P6 anti-spam)
const RATE_LIMITS_MS: Record<string, number> = {
  pit: 1500,
  cancelPit: 1500,
  restart: 10000,
  pause: 500,
  speed: 500,
  startReaction: 200,
  hammerTime: 300,
  setStartingTyre: 800,
  setPushLevel: 300,
};

const VALID_COMPOUNDS: ReadonlySet<TyreCompound> = new Set<TyreCompound>([
  "soft",
  "medium",
  "hard",
  "intermediate",
  "wet",
]);

const VALID_MODES: ReadonlySet<HammerMode> = new Set<HammerMode>([
  "attack",
  "defend",
  "push",
]);

const VALID_PUSH_STRATEGIES: ReadonlySet<PushStrategy> = new Set<PushStrategy>([
  "conservative",
  "balanced",
  "attack",
]);

// Soft-currency award cap per race (S3-4). Better finishes earn more; capped so a dominant P1
// in a full 20-car field doesn't trivialize the cosmetic economy.
const SOFT_CURRENCY_PER_RACE_CAP = 100;

const DRY_COMPOUNDS: TyreCompound[] = ["soft", "medium", "hard"];

function sampleWeather(rng: Rng): Weather {
  const p = CONFIG.weather.probability;
  const r = rng.next();
  let acc = p.dry;
  if (r < acc) return "dry";
  acc += p.lightRain;
  if (r < acc) return "lightRain";
  acc += p.heavyRain;
  if (r < acc) return "heavyRain";
  return "variable";
}

function sampleTimeOfDay(rng: Rng): TimeOfDay {
  const p = CONFIG.timeOfDay.probability;
  const r = rng.next();
  if (r < p.day) return "day";
  if (r < p.day + p.sunset) return "sunset";
  return "night";
}

function compoundForWeather(weather: Weather, rng: Rng): TyreCompound {
  if (weather === "heavyRain") return rng.bool(0.9) ? "wet" : "intermediate";
  if (weather === "lightRain") return rng.bool(0.7) ? "intermediate" : "medium";
  return rng.pick(DRY_COMPOUNDS);
}

export type ConnectionId = string;

export interface RoomSink {
  send(msg: ServerMessage): void;
  isOpen(): boolean;
}

interface RoomConnection {
  connectionId: ConnectionId;
  sink: RoomSink;
  hero: PilotProfile;
  driverId: string;
  connected: boolean;
  sessionToken: string;
  graceTimer: ReturnType<typeof setTimeout> | null;
  // null for ephemeral (no guestId) connections; set when a profile was loaded/created.
  guestId: string | null;
  savedProfile: DriverProfile | null;
  // High-water mark of the last event seq delivered to this connection. Each race snapshot
  // sent to the client carries only events with seq > lastEventSeq (delta encoding) so the
  // per-tick payload stays small as the race's event log grows.
  lastEventSeq: number;
  // Last push-level the player committed this race (S2-4). The engine resets car.pushStrategy
  // to "balanced" on a fresh-tyre pit exit; we re-apply this after the pit completes so the
  // player's strategic choice survives a stop. Null until the first setPushLevel.
  committedStrategy: PushStrategy | null;
}

export class RoomJoinError extends Error {}

export interface ResolvedProfile {
  hero: PilotProfile;
  guestId: string | null;
  profile: DriverProfile | null;
}

// Resolve (load/create) a persisted profile for a guestId. Called from the hello handler
// (via the lobby enqueue path) so the lobby can read the player's division for matching.
// No guestId (or no repo) → ephemeral: race works, nothing persists.
export function resolveHeroProfile(
  repository: DriverProfileRepository | null,
  hero: PilotProfile,
  guestId: string | undefined,
): ResolvedProfile {
  if (!guestId || !repository) {
    return { hero, guestId: guestId ?? null, profile: null };
  }
  const now = Date.now();
  const existing = repository.get(guestId);
  if (existing) {
    // Anti-cheat (S0-1): never let a client hello overwrite a confirmed pilot's skills/tyres.
    // Skills are server-owned (training/respec/allocateSkill); only cosmetic fields may flow in
    // from the WS hello. Unconfirmed profiles still accept the full hero (first-connect setup).
    if (existing.heroConfirmed) {
      existing.hero = {
        ...existing.hero,
        name: hero.name,
        country: hero.country,
        team: hero.team,
      };
    } else {
      existing.hero = hero;
    }
    existing.updatedAt = now;
    repository.upsert(existing);
    return { hero: existing.hero, guestId, profile: existing };
  }
  // A missing Yandex profile (e.g. after a reset) re-created here MUST still pass the
  // first-login onboarding gate — otherwise a `hello` carrying an authToken silently
  // resurrects the profile as already-confirmed and the SetupScreen never shows. Plain guest
  // identities (no Yandex OAuth) skip the gate as before.
  const isYandex = guestId.startsWith("yandex:");
  const created: DriverProfile = {
    guestId,
    hero,
    totalXp: 0,
    racesCount: 0,
    heroConfirmed: !isYandex,
    // Same reasoning as the Yandex callback: a freshly (re)created profile hasn't run the
    // guided first race, so the hub should route to the tutorial. Defaults to skipped for
    // legacy rows; explicit here so a reset actually re-triggers it.
    tutorialCompleted: false,
    createdAt: now,
    updatedAt: now,
  };
  repository.upsert(created);
  return { hero, guestId, profile: created };
}

type CommandError = string | null;

function progressFromXp(totalXp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
} {
  const level = levelFromXp(totalXp);
  let cumulative = 0;
  for (let l = 1; l < level; l++) cumulative += CONFIG.level.xpToNext(l);
  return { level, xpIntoLevel: totalXp - cumulative, xpForNext: CONFIG.level.xpToNext(level) };
}

function profileSummary(p: DriverProfile): {
  guestId: string;
  hero: PilotProfile;
  level: number;
  division: Division;
  driverRating: number;
  heroConfirmed: boolean;
  totalXp: number;
  racesCount: number;
  tutorialCompleted: boolean;
  unspentSkillPoints: number;
  softCurrency: number;
} {
  const level = levelFromXp(p.totalXp);
  const rating = driverRating(level, skillSum(p.hero.skills));
  return {
    guestId: p.guestId,
    hero: p.hero,
    level,
    division: divisionForRating(rating),
    driverRating: rating,
    heroConfirmed: p.heroConfirmed,
    totalXp: p.totalXp,
    racesCount: p.racesCount,
    tutorialCompleted: p.tutorialCompleted ?? true,
    unspentSkillPoints: p.unspentSkillPoints ?? 0,
    softCurrency: p.softCurrency ?? 0,
  };
}

export class Room {
  readonly id: string;
  onEmpty: (() => void) | null = null;
  private stage: Stage = "qualy";
  private speed = DEFAULT_SPEED;
  private paused = false;
  private seed = 42;
  private drivers: Driver[] = [];
  private connections = new Map<ConnectionId, RoomConnection>();
  private tokens = new Map<string, ConnectionId>();
  private lastCommandAt = new Map<ConnectionId, Record<string, number>>();
  private qualy: QualifyingEngine | null = null;
  private race: RaceEngine | null = null;
  private result: RaceResult | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  // lights-out start sequence (spec P2 / Phase 2)
  private sequenceId = 0;
  private lightsOutAt: number | null = null;
  private sequenceResolveAt: number | null = null;
  private sequenceTimer: ReturnType<typeof setTimeout> | null = null;
  private startReactions = new Map<string, number>(); // driverId -> server receipt ms (first click only)
  private startResults = new Map<string, { reactionSec: number; jumpStart: boolean; category: StartCategory }>();
  // Pre-qualifying tyre pick (per connection). Captured during qualy/startSequence via
  // setStartingTyre and applied to the hero Driver when the race grid is built (startRace).
  private pendingStartingTyre = new Map<ConnectionId, TyreCompound>();
  // Assigned by rerollConditions() (called from the constructor and on restart).
  private track!: Track;
  private weather!: Weather;
  private timeOfDay!: TimeOfDay;

  constructor(private repository: DriverProfileRepository | null = null) {
    this.id = randomUUID();
    // Random per-room initial seed so different rooms get different first races (track /
    // weather / timeOfDay). restart() still mutates this deterministically, so each room's
    // race stays reproducible given its seed — only the STARTING point varies per room.
    // (Previously this was a constant 42, which made EVERY fresh room open on the same track.)
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.rerollConditions();
  }

  // Pick track/weather/timeOfDay from the room's RNG for determinism within a seed.
  // Called at construction and on restart so a new race can change conditions.
  private rerollConditions(): void {
    const rng = mulberry32(this.seed);
    this.track = randomTrack(rng);
    this.weather = sampleWeather(rng);
    this.timeOfDay = sampleTimeOfDay(rng);
  }

  get currentStage(): Stage {
    return this.stage;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  get activeConnectionCount(): number {
    let n = 0;
    for (const c of this.connections.values()) if (c.connected) n++;
    return n;
  }

  // True if a LIVE (connected) connection in this room already holds this identity.
  // Lingering grace-period sockets (connected=false after a drop, awaiting reconnect/eviction)
  // do NOT count — the player may legitimately re-enter once their old socket is gone.
  hasLiveGuest(guestId: string): boolean {
    for (const c of this.connections.values()) {
      if (c.connected && c.guestId != null && c.guestId === guestId) return true;
    }
    return false;
  }

  get mode(): RoomMode {
    return this.activeConnectionCount >= 2 ? "multiplayer" : "solo";
  }

  canJoin(): boolean {
    return this.stage === "qualy" && this.connections.size < FIELD_SIZE;
  }

  addConnection(
    connectionId: ConnectionId,
    sink: RoomSink,
    hero: PilotProfile,
    guestId?: string,
    resolved?: ResolvedProfile,
  ): string {
    const existing = this.connections.get(connectionId);
    if (existing) return existing.driverId;
    if (!this.canJoin()) {
      throw new RoomJoinError(this.stage === "qualy" ? "room is full" : "room is not in qualifying stage");
    }
    const driverId = nextDriverId("p");
    const sessionToken = this.makeToken(driverId);
    const r = resolved ?? this.resolveProfile(hero, guestId);
    this.connections.set(connectionId, {
      connectionId,
      sink,
      hero: r.hero,
      driverId,
      connected: true,
      sessionToken,
      graceTimer: null,
      guestId: r.guestId,
      savedProfile: r.profile,
      lastEventSeq: 0,
      committedStrategy: null,
    });
    this.tokens.set(sessionToken, connectionId);
    const welcome: ServerMessage = {
      type: "welcome",
      driverId,
      sessionToken,
      mode: this.mode,
    };
    if (r.profile) welcome.profile = profileSummary(r.profile);
    welcome.track = {
      id: this.track.id,
      name: this.track.name,
      country: this.track.country,
      lengthM: this.track.lengthM,
      laps: recommendedLaps(this.track),
    };
    welcome.weather = this.weather;
    welcome.timeOfDay = this.timeOfDay;
    sink.send(welcome);
    this.rebuildField();
    this.restartQualy();
    this.start();
    this.emitStage();
    this.emitSnapshot();
    this.emitRoomState();
    return driverId;
  }

  // Fallback resolution for callers that did not pre-resolve (e.g. legacy unit tests).
  private resolveProfile(
    hero: PilotProfile,
    guestId: string | undefined,
  ): ResolvedProfile {
    return resolveHeroProfile(this.repository, hero, guestId);
  }

  removeConnection(connectionId: ConnectionId): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    if (conn.connected) {
      conn.connected = false;
      if (conn.graceTimer) clearTimeout(conn.graceTimer);
      conn.graceTimer = setTimeout(() => this.evict(connectionId), gracePeriodMs());
      this.emitRoomState();
    }
  }

  reconnect(
    connectionId: ConnectionId,
    sessionToken: string,
    sink: RoomSink,
  ): { ok: true; driverId: string } | { ok: false; error: string } {
    const oldConnectionId = this.tokens.get(sessionToken);
    if (!oldConnectionId) return { ok: false, error: "invalid or expired session token" };
    const old = this.connections.get(oldConnectionId);
    if (!old) {
      this.tokens.delete(sessionToken);
      return { ok: false, error: "invalid or expired session token" };
    }
    if (old.connected) {
      return { ok: false, error: "invalid or expired session token" };
    }
    if (old.graceTimer) {
      clearTimeout(old.graceTimer);
      old.graceTimer = null;
    }
    this.connections.delete(oldConnectionId);
    this.lastCommandAt.delete(oldConnectionId);
    // Reconnecting clients skip the event backlog: race events are ephemeral UX (overtake/pit
    // flashes), not authoritative state — the snapshot's cars/results are already authoritative.
    // Resending missed events on rejoin would replay stale cinematics out of context, so we pin
    // lastEventSeq to the engine's current counter and let only freshly-emitted events flow.
    const reboundLastEventSeq = this.race?.currentEventSeq ?? 0;
    const rebound: RoomConnection = {
      connectionId,
      sink,
      hero: old.hero,
      driverId: old.driverId,
      connected: true,
      sessionToken,
      graceTimer: null,
      guestId: old.guestId,
      savedProfile: old.savedProfile,
      lastEventSeq: reboundLastEventSeq,
      committedStrategy: old.committedStrategy,
    };
    this.connections.set(connectionId, rebound);
    this.tokens.set(sessionToken, connectionId);
    const welcome: ServerMessage = {
      type: "welcome",
      driverId: rebound.driverId,
      sessionToken,
      mode: this.mode,
    };
    if (rebound.savedProfile) welcome.profile = profileSummary(rebound.savedProfile);
    welcome.track = {
      id: this.track.id,
      name: this.track.name,
      country: this.track.country,
      lengthM: this.track.lengthM,
      laps: recommendedLaps(this.track),
    };
    welcome.weather = this.weather;
    welcome.timeOfDay = this.timeOfDay;
    sink.send(welcome);
    sink.send({ type: "stage", stage: this.stage });
    // Re-send the current lights-out sequence so reconnecting players see the lights.
    if (this.stage === "startSequence" && this.lightsOutAt != null) {
      sink.send({ type: "startSequence", lightsOutAt: this.lightsOutAt, sequenceId: this.sequenceId });
    }
    this.emitSnapshotTo(connectionId);
    this.emitRoomState();
    return { ok: true, driverId: rebound.driverId };
  }

  ownsDriver(connectionId: ConnectionId, driverId: string): boolean {
    const conn = this.connections.get(connectionId);
    return !!conn && conn.driverId === driverId;
  }

  driverIdOf(connectionId: ConnectionId): string | null {
    return this.connections.get(connectionId)?.driverId ?? null;
  }

  private connectionByDriverId(driverId: string): RoomConnection | null {
    for (const c of this.connections.values()) {
      if (c.driverId === driverId) return c;
    }
    return null;
  }

  setSpeed(connectionId: ConnectionId, value: number): CommandError {
    if (!this.connections.has(connectionId)) return "no room for connection";
    if (typeof value !== "number" || !Number.isFinite(value)) return "invalid speed";
    if (this.mode === "multiplayer") return "speed control not available in multiplayer";
    if (!this.rateLimitOk(connectionId, "speed")) return "rate limit: speed";
    this.speed = Math.max(1, Math.min(30, Math.round(value)));
    return null;
  }

  setPaused(connectionId: ConnectionId, paused: boolean): CommandError {
    if (!this.connections.has(connectionId)) return "no room for connection";
    if (this.mode === "multiplayer") return "pause control not available in multiplayer";
    if (!this.rateLimitOk(connectionId, "pause")) return "rate limit: pause";
    this.paused = paused;
    return null;
  }

  requestPit(connectionId: ConnectionId, compound: TyreCompound): CommandError {
    if (!VALID_COMPOUNDS.has(compound)) return "invalid tyre compound";
    const driverId = this.driverIdOf(connectionId);
    if (!driverId) return "no driver for connection";
    if (!this.rateLimitOk(connectionId, "pit")) return "rate limit: pit";
    if (this.stage !== "race" || !this.race) return "pit only available during the race";
    const result = this.race.requestPit(driverId, compound);
    if (result === "queued") return null;
    if (result === "rejected_unknown_driver") return "unknown driver";
    if (result === "rejected_not_racing") return "pit only available during the race";
    return null;
  }

  cancelPit(connectionId: ConnectionId): CommandError {
    const driverId = this.driverIdOf(connectionId);
    if (!driverId) return "no driver for connection";
    if (!this.rateLimitOk(connectionId, "cancelPit")) return "rate limit: cancelPit";
    if (this.stage !== "race" || !this.race) return "pit only available during the race";
    this.race.cancelPit(driverId);
    return null;
  }

  requestHammer(connectionId: ConnectionId, mode: HammerMode): CommandError {
    if (!VALID_MODES.has(mode)) return "invalid hammer mode";
    const driverId = this.driverIdOf(connectionId);
    if (!driverId) return "no driver for connection";
    if (!this.rateLimitOk(connectionId, "hammerTime")) return "rate limit: hammerTime";
    if (this.stage !== "race" || !this.race) return "hammer not available now";
    const result = this.race.requestHammer(driverId, mode);
    switch (result) {
      case "activated":
        return null;
      case "rejected_cooldown":
        return "hammer time on cooldown";
      case "rejected_pit":
        return "cannot activate hammer time in pits";
      case "rejected_first_lap":
        return "hammer time locked on lap 1";
      case "rejected_tyre_wear":
        return "tyre wear too high for hammer time";
      case "rejected_unknown_driver":
      case "rejected_not_racing":
        return "hammer not available now";
      default:
        return null;
    }
  }

  requestSetStartingTyre(connectionId: ConnectionId, compound: TyreCompound): CommandError {
    if (!this.connections.has(connectionId)) return "no room for connection";
    if (!VALID_COMPOUNDS.has(compound)) return "invalid tyre compound";
    if (!this.rateLimitOk(connectionId, "setStartingTyre")) return "rate limit: setStartingTyre";
    if (this.stage !== "qualy" && this.stage !== "startSequence") {
      return "tyre can only be chosen before the race";
    }
    this.pendingStartingTyre.set(connectionId, compound);
    return null;
  }

  // Per-stint push-level commitment (S2-4). Validates the strategy, maps to the hero driverId,
  // and forwards to the engine's requestPushLevel. The committed strategy is remembered on the
  // connection so it can be re-applied after a pit stop (the engine resets to balanced on exit).
  requestPushLevel(connectionId: ConnectionId, strategy: PushStrategy): CommandError {
    if (!VALID_PUSH_STRATEGIES.has(strategy)) return "invalid push strategy";
    const conn = this.connections.get(connectionId);
    if (!conn) return "no room for connection";
    if (!this.rateLimitOk(connectionId, "setPushLevel")) return "rate limit: setPushLevel";
    if (this.stage !== "race" || !this.race) return "push level only available during the race";
    const result = this.race.requestPushLevel(conn.driverId, strategy);
    if (result === "rejected_unknown_driver") return "unknown driver";
    if (result === "rejected_not_racing") return "not racing";
    conn.committedStrategy = strategy;
    return null;
  }

  recordStartReaction(
    connectionId: ConnectionId,
    clientTimestamp: number,
    sequenceId: number,
  ): CommandError {
    const conn = this.connections.get(connectionId);
    if (!conn) return "no room for connection";
    if (this.stage !== "startSequence") return "start reaction only available during the start sequence";
    // Stale click for a previous sequence (e.g. arrived after a restart): ignore silently.
    // `clientTimestamp` is recorded for completeness but, per spec P2, never used for fairness.
    if (sequenceId !== this.sequenceId) return null;
    if (!this.rateLimitOk(connectionId, "startReaction")) return "rate limit: startReaction";
    if (!this.startReactions.has(conn.driverId)) {
      this.startReactions.set(conn.driverId, Date.now());
    }
    // Resolve early once every human has reacted — no need to stare at the full window.
    if (this.allHumansReacted()) this.resolveStartSequence();
    return null;
  }

  restart(connectionId: ConnectionId): CommandError {
    if (!this.connections.has(connectionId)) return "no room for connection";
    if (this.mode === "multiplayer") return "restart disabled in multiplayer";
    if (!this.rateLimitOk(connectionId, "restart")) return "rate limit: restart";
    this.stop();
    this.clearStartSequence();
    this.pendingStartingTyre.clear();
    for (const c of this.connections.values()) c.committedStrategy = null;
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    this.rerollConditions();
    this.race = null;
    this.result = null;
    this.stage = "qualy";
    this.rebuildField();
    this.restartQualy();
    this.start();
    this.emitStage();
    this.emitSnapshot();
    this.emitRoomState();
    return null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.clearSequenceTimer();
    for (const conn of this.connections.values()) {
      if (conn.graceTimer) {
        clearTimeout(conn.graceTimer);
        conn.graceTimer = null;
      }
    }
  }

  tick(): void {
    if (this.paused) return;
    // Solo and multiplayer both fast-forward at the room's `speed` (default DEFAULT_SPEED=6,
    // ~6x real-time). There is no real-time driving input in this game (the protocol carries
    // only pit / hammerTime / start-reaction — no throttle/brake), and the lights-out reaction
    // is a separate real-time phase, so fast-forwarding the race phase is safe and keeps
    // multiplayer pace equal to solo (previously multiplayer was locked to 1 step/tick = 1x,
    // which made 2-player races feel ~6x slower, and a player disconnecting flipped the room
    // 2x→1x mode causing a visible speedup for whoever stayed).
    const eff = this.speed;
    const steps = Math.max(1, Math.round((eff * (TICK_MS / 1000)) / DT));
    if (this.stage === "qualy" && this.qualy) {
      let n = steps;
      while (n-- > 0 && this.qualy.phase === "running") this.qualy.step(DT);
      if (this.qualy.phase === "finished") this.beginStartSequence(randomStartDelayMs());
      this.emitSnapshot();
    } else if (this.stage === "race" && this.race) {
      this.stepRaceWithReapply(steps);
      if (this.race?.phase === "finished") this.finishRace();
      this.emitSnapshot();
    }
    // "startSequence" has no per-tick work: resolution is driven by startReaction (early)
    // and sequenceTimer (hard deadline at lightsOutAt + REACTION_WINDOW_MS).
  }

  // Step the race engine `steps` times, then re-apply any committed non-balanced push strategy
  // to cars that just exited the pits (the engine resets to balanced on fresh-tyre exit). The
  // inPits transition is detected by snapshotting which cars were in the pits before stepping.
  private stepRaceWithReapply(steps: number): void {
    if (!this.race) return;
    const inPitsBefore = new Set<string>();
    for (const c of this.race.cars) if (c.inPits) inPitsBefore.add(c.driverId);
    let n = steps;
    while (n-- > 0 && this.race.phase === "racing") this.race.step(DT);
    if (this.race && this.race.phase === "racing") {
      for (const c of this.race.cars) {
        if (inPitsBefore.has(c.driverId) && !c.inPits) {
          const conn = this.connectionByDriverId(c.driverId);
          const strat = conn?.committedStrategy;
          if (strat && strat !== "balanced") this.race.requestPushLevel(c.driverId, strat);
        }
      }
    }
  }

  private rateLimitOk(connectionId: ConnectionId, cmd: string): boolean {
    const min = RATE_LIMITS_MS[cmd];
    if (min == null) return true;
    const now = Date.now();
    const map = this.lastCommandAt.get(connectionId) ?? {};
    const last = map[cmd] ?? 0;
    if (now - last < min) return false;
    map[cmd] = now;
    this.lastCommandAt.set(connectionId, map);
    return true;
  }

  private evict(connectionId: ConnectionId): void {
    const conn = this.connections.get(connectionId);
    if (!conn || conn.connected) return;
    this.tokens.delete(conn.sessionToken);
    this.lastCommandAt.delete(connectionId);
    this.connections.delete(connectionId);
    if (this.connections.size === 0) {
      this.stop();
      this.onEmpty?.();
    } else {
      this.emitRoomState();
    }
  }

  private makeToken(driverId: string): string {
    return `${this.id}:${driverId}:${randomUUID()}`;
  }

  private rebuildField(): void {
    const rng = mulberry32(this.seed);
    const drivers: Driver[] = [];
    let playerMax = 0;
    for (const conn of this.connections.values()) {
      drivers.push(this.makeHumanDriver(conn.hero, conn.driverId));
      playerMax = Math.max(playerMax, skillSum(conn.hero.skills));
    }
    if (playerMax === 0) playerMax = STARTING_SKILL_POINTS;
    const division = this.botDivision();
    const divIdx = divisionIndex(division);
    let botIndex = 0;
    while (drivers.length < FIELD_SIZE) {
      const startingTyre = compoundForWeather(this.weather, rng);
      const jitter = Math.round(rng.range(-CONFIG.bots.jitterSpread, CONFIG.bots.jitterUp));
      const rival = botIndex === 0;
      const budget = Math.max(
        STARTING_SKILL_POINTS,
        playerMax + divIdx * CONFIG.bots.divIndexCoefficient + jitter + (rival ? CONFIG.bots.rivalBonus : 0),
      );
      drivers.push(makeBot({ startingTyre, skillBudget: budget }, rng));
      botIndex++;
    }
    this.drivers = drivers;
  }

  // The division used to scale bot strength: take the strongest division among connected
  // humans (so a veteran lifting a rookie room still gets challenged); F4 when nobody has a
  // persisted profile (ephemeral solo). Matchmaking normally keeps a room single-division.
  private botDivision(): "F4" | "F3" | "F2" | "F1" {
    const rank = { F4: 0, F3: 1, F2: 2, F1: 3 } as const;
    let best: "F4" | "F3" | "F2" | "F1" = "F4";
    for (const conn of this.connections.values()) {
      if (!conn.savedProfile) continue;
      const d = divisionForRating(driverRating(levelFromXp(conn.savedProfile.totalXp), skillSum(conn.savedProfile.hero.skills)));
      if (rank[d] > rank[best]) best = d;
    }
    return best;
  }

  private makeHumanDriver(profile: PilotProfile, driverId: string): Driver {
    return makeDriver({
      id: driverId,
      name: profile.name || "Вы",
      country: profile.country,
      kind: "human",
      team: profile.team,
      skills: profile.skills,
      startingTyre: profile.startingTyre,
      pitPlan: { targetStops: 1, strategy: "flexible", compound: profile.pitCompound },
      // Placeholder — always overwritten by the lights-out sequence before RaceEngine
      // is constructed (see resolveStartSequence). Defensive default = a stalled launch.
      reactionTimeSec: START_LATE_REACTION_SEC,
    });
  }

  private restartQualy(): void {
    this.qualy = new QualifyingEngine(
      buildQualyConfig({
        track: this.track,
        drivers: this.drivers,
        seed: this.seed * 7 + 1,
        startIntervalSec: 5,
        weather: this.weather,
      }),
    );
    this.stage = "qualy";
    this.race = null;
    this.result = null;
  }

  private startRace(): void {
    // Apply the player's pre-qualifying tyre choice (setStartingTyre during qualy/startSequence)
    // to their hero Driver before the race grid is constructed. Bots keep compoundForWeather.
    for (const conn of this.connections.values()) {
      const tyre = this.pendingStartingTyre.get(conn.connectionId);
      if (!tyre) continue;
      const d = this.drivers.find((x) => x.id === conn.driverId);
      if (d) d.startingTyre = tyre;
    }
    const order = this.qualy!.gridOrder();
    const byId = new Map(this.drivers.map((d) => [d.id, d]));
    const grid: Driver[] = [];
    for (const id of order) {
      const d = byId.get(id);
      if (d) grid.push(d);
    }
    if (grid.length === 0) grid.push(...this.drivers);
    const track = this.track;
    this.race = new RaceEngine(
      buildRaceConfig({
        track,
        drivers: grid,
        totalLaps: recommendedLaps(track),
        seed: this.seed * 13 + 5,
        dt: DT,
      }),
      { weather: this.weather, timeOfDay: this.timeOfDay },
    );
    this.stage = "race";
    this.emitStage();
  }

  private beginStartSequence(
    delayMs: number = START_SEQUENCE_DELAY_MS,
    windowMs: number = REACTION_WINDOW_MS,
    now: number = Date.now(),
  ): void {
    if (this.stage !== "qualy") return;
    this.clearSequenceTimer();
    this.stage = "startSequence";
    this.sequenceId += 1;
    this.lightsOutAt = now + delayMs;
    this.sequenceResolveAt = this.lightsOutAt + windowMs;
    this.startReactions.clear();
    this.startResults.clear();
    this.emitStage();
    this.broadcastMsg({ type: "startSequence", lightsOutAt: this.lightsOutAt, sequenceId: this.sequenceId });
    const delay = Math.max(0, this.sequenceResolveAt - Date.now());
    this.sequenceTimer = setTimeout(() => this.resolveStartSequence(), delay);
  }

  private allHumansReacted(): boolean {
    for (const d of this.drivers) {
      if (d.kind !== "human") continue;
      if (!this.startReactions.has(d.id)) return false;
    }
    return true;
  }

  private resolveStartSequence(): void {
    if (this.stage !== "startSequence") return;
    this.clearSequenceTimer();
    const lightsOutAt = this.lightsOutAt ?? Date.now();
    for (const d of this.drivers) {
      if (d.kind !== "human") continue;
      const receipt = this.startReactions.get(d.id);
      if (receipt == null) {
        d.reactionTimeSec = START_LATE_REACTION_SEC;
        const category = startCategory(START_LATE_REACTION_SEC, false);
        this.startResults.set(d.id, { reactionSec: START_LATE_REACTION_SEC, jumpStart: false, category });
      } else {
        const r = resolveEffectiveReactionSec(receipt, lightsOutAt, DEFAULT_REACTION_OPTIONS);
        d.reactionTimeSec = r.reactionSec;
        const category = startCategory(r.reactionSec, r.jumpStart);
        this.startResults.set(d.id, { reactionSec: r.reactionSec, jumpStart: r.jumpStart, category });
      }
    }
    this.emitStartResults();
    this.startRace();
  }

  private clearSequenceTimer(): void {
    if (this.sequenceTimer) {
      clearTimeout(this.sequenceTimer);
      this.sequenceTimer = null;
    }
  }

  private clearStartSequence(): void {
    this.clearSequenceTimer();
    this.lightsOutAt = null;
    this.sequenceResolveAt = null;
    this.startReactions.clear();
    this.startResults.clear();
  }

  private emitStartResults(): void {
    for (const conn of this.connections.values()) {
      if (!conn.connected || !conn.sink.isOpen()) continue;
      const r = this.startResults.get(conn.driverId);
      if (r) {
        conn.sink.send({
          type: "startResult",
          driverId: conn.driverId,
          reactionSec: r.reactionSec,
          jumpStart: r.jumpStart,
          category: r.category,
        });
      }
    }
  }

  // --- test-only seams (clearly marked; not for production callers) ---
  /** @internal Force the lights-out sequence without running a full qualy. */
  beginStartSequenceForTest(opts?: { delayMs?: number; windowMs?: number }): void {
    this.stage = "qualy";
    this.beginStartSequence(opts?.delayMs, opts?.windowMs, Date.now());
  }
  /** @internal Force resolution (window-expiry path) without waiting. */
  resolveStartSequenceForTest(): void {
    this.resolveStartSequence();
  }
  /** @internal Emit a snapshot synchronously to all sinks (for mid-race assertions, e.g.
    *  verifying hammerTime state after a requestHammer call that doesn't itself emit). */
  __emitSnapshotForTest(): void {
    this.emitSnapshot();
  }
  /** @internal Step the race one tick-batch at the room's speed, mirroring the production tick
    *  (incl. pit-exit strategy re-apply). For tests that need to observe mid-race state changes
    *  driven by the tick loop without the real setInterval. Returns when the race finishes. */
  __stepRaceForTest(): void {
    if (this.stage !== "race" || !this.race) return;
    const steps = Math.max(1, Math.round((this.speed * (TICK_MS / 1000)) / DT));
    this.stepRaceWithReapply(steps);
    if (this.race?.phase === "finished") this.finishRace();
    this.emitSnapshot();
  }
  /** @internal Step the race engine until the given driver's lap >= minLap, or the race
   *  ends / maxSteps is hit. Used to release the hammer-time first-lap lock (car.lap >= 2)
   *  without over-stepping into high tyre wear. */
  __stepUntilLapForTest(driverId: string, minLap: number, maxSteps = 200000): void {
    if (!this.race || this.stage !== "race") return;
    for (let i = 0; i < maxSteps && this.race.phase === "racing"; i++) {
      const car = this.race.cars.find((c) => c.driverId === driverId);
      if (car && car.lap >= minLap) return;
      this.race.step(DT);
    }
  }
  /** @internal Read back the measured reactionTimeSec applied to a driver. */
  testGetDriverReactionSec(driverId: string): number | null {
    const d = this.drivers.find((x) => x.id === driverId);
    return d ? d.reactionTimeSec : null;
  }
  /** @internal Read back every bot's reactionTimeSec (humans are measured; bots are not). */
  testGetBotReactionSecs(): number[] {
    return this.drivers.filter((d) => d.kind === "bot").map((d) => d.reactionTimeSec);
  }
  /** @internal Read back a driver's current startingTyre (post setStartingTyre override). */
  testGetDriverStartingTyre(driverId: string): TyreCompound | null {
    const d = this.drivers.find((x) => x.id === driverId);
    return d ? d.startingTyre : null;
  }
  /** @internal Does this room currently field a driver with this id? (test room lookup) */
  testHasDriverId(driverId: string): boolean {
    return this.drivers.some((d) => d.id === driverId);
  }
  /** @internal Invoke the finish-progression path with a synthetic result (reaching a real
   *  finish takes minutes; this exercises the identical code used by finishRace). */
  applyProgressForTest(result: RaceResult): void {
    this.applyProgression(result);
  }
  /** @internal Drive the room synchronously to the race stage (or to finish) without any
   *  real-time waiting. Reaches a real race in tests by stepping the same private methods
   *  the production tick uses (qualy.step → beginStartSequence → startRace → race.step →
   *  finishRace). `stopAtRace` stops right after the race starts (for mid-race assertions);
   *  the default drives all the way to finish + progression. Not for production callers. */
  __advanceForTest(opts: { reactionSec?: number; stopAtRace?: boolean } = {}): void {
    const reactionSec = opts.reactionSec ?? 0.2;
    if (this.stage === "qualy" && this.qualy) {
      let guard = 0;
      while (this.qualy.phase === "running" && guard++ < 200000) this.qualy.step(DT);
      this.beginStartSequence(0, 0, Date.now());
    }
    if (this.stage === "startSequence") {
      this.clearSequenceTimer();
      for (const d of this.drivers) {
        if (d.kind !== "human") continue;
        d.reactionTimeSec = reactionSec;
        const category = startCategory(reactionSec, false);
        this.startResults.set(d.id, { reactionSec, jumpStart: false, category });
      }
      this.emitStartResults();
      this.startRace();
    }
    if (opts.stopAtRace) {
      this.emitSnapshot();
      return;
    }
    if (this.stage === "race" && this.race) {
      let guard = 0;
      while (this.race.phase === "racing" && guard++ < 5000000) this.race.step(DT);
      if (this.race.phase === "finished") this.finishRace();
    }
  }

  private finishRace(): void {
    const result = this.race!.result();
    this.result = result;
    this.stage = "finished";
    this.emitStage();
    this.emitResult();
    this.applyProgression(result);
  }

  // Persistence side-effect AFTER the deterministic result is computed — never feeds back
  // into the engine. Bots and ephemeral (no-profile) humans are skipped.
  private applyProgression(result: RaceResult): void {
    if (!this.repository) return;
    const rowsByDriver = new Map<string, RaceResultRow>();
    for (const r of result.rows) rowsByDriver.set(r.driverId, r);
    const today = Math.floor(Date.now() / 86_400_000);
    for (const conn of this.connections.values()) {
      const profile = conn.savedProfile;
      if (!profile) continue;
      const row = rowsByDriver.get(conn.driverId);
      if (!row) continue;
      const baseXp = xpForRace({
        place: row.place,
        gridSize: result.rows.length,
        fastestLap: row.fastestLap,
        positionsGained: row.positionsGained,
        dnf: row.dnf,
        polePosition: row.gridPosition === 1,
      });
      // S2-10 daily-streak recompute. Same-day race → no change. Yesterday → extend (cap 7).
      // Older gap (or never-raced) → start fresh at 1. Multiplier is +10% per day past 1.
      const prevDay = profile.lastRaceDay ?? null;
      let streakDays: number;
      if (prevDay === today) {
        streakDays = profile.streakDays ?? 1;
      } else if (prevDay === today - 1) {
        streakDays = Math.min((profile.streakDays ?? 0) + 1, 7);
      } else {
        streakDays = 1;
      }
      profile.lastRaceDay = today;
      profile.streakDays = streakDays;
      const multiplier = 1 + 0.1 * (streakDays - 1);
      const xpGained = Math.round(baseXp * multiplier);
      const oldXp = profile.totalXp;
      profile.totalXp += xpGained;
      profile.racesCount += 1;
      // Bank spendable skill points for any level(s) gained this race (pointsPerLevel each).
      profile.unspentSkillPoints = (profile.unspentSkillPoints ?? 0) + levelUpPointsAccrued(oldXp, profile.totalXp);
      // S3-4 soft currency: better finishes earn more. DNFs earn nothing (no participation
      // trophy for crashing out). Capped so a P1 in a full field doesn't inflate the economy.
      if (!row.dnf) {
        const positionsAheadOfLast = Math.max(0, result.rows.length - row.place);
        const earned = Math.min(SOFT_CURRENCY_PER_RACE_CAP, 10 + 5 * positionsAheadOfLast);
        profile.softCurrency = (profile.softCurrency ?? 0) + earned;
      }
      profile.updatedAt = Date.now();
      this.repository.recordRaceFinish(profile, {
        profileId: profile.guestId,
        finishedAt: profile.updatedAt,
        place: row.place,
        gridPosition: row.gridPosition,
        fastestLapDriverId: result.fastestLapDriverId,
        positionsGained: row.positionsGained,
        xpGained,
        dnf: row.dnf,
      });
      // S2-9 daily quest progress hooks. Assign today's quests first (idempotent) so progress
      // is captured even if the player never opened the quests panel, then bump each relevant
      // quest by its delta. incrementQuestProgress is a no-op for quests not assigned today.
      this.repository.assignDailyQuests(profile.guestId, today, pickDailyQuestIds(profile.guestId, today));
      this.repository.incrementQuestProgress(profile.guestId, "finish_race", today, 1);
      if (row.place <= 5) this.repository.incrementQuestProgress(profile.guestId, "finish_top5", today, 1);
      if (row.positionsGained > 0) this.repository.incrementQuestProgress(profile.guestId, "overtakes_2", today, row.positionsGained);
      if (row.tyreStops > 0) this.repository.incrementQuestProgress(profile.guestId, "pit_stop", today, 1);
      if (row.fastestLap) this.repository.incrementQuestProgress(profile.guestId, "fastest_lap", today, 1);
      const prog = progressFromXp(profile.totalXp);
      if (conn.connected && conn.sink.isOpen()) {
        const rating = driverRating(prog.level, skillSum(profile.hero.skills));
        conn.sink.send({
          type: "progression",
          xpGained,
          totalXp: profile.totalXp,
          level: prog.level,
          xpIntoLevel: prog.xpIntoLevel,
          xpForNext: prog.xpForNext,
          division: divisionForRating(rating),
          racesCount: profile.racesCount,
          streakDays,
        });
      }
    }
  }

  private broadcast(build: (driverId: string, conn: RoomConnection) => ServerMessage): void {
    for (const conn of this.connections.values()) {
      if (!conn.connected) continue;
      if (!conn.sink.isOpen()) continue;
      conn.sink.send(build(conn.driverId, conn));
    }
  }

  private broadcastMsg(msg: ServerMessage): void {
    this.broadcast(() => msg);
  }

  private emitStage(): void {
    this.broadcastMsg({ type: "stage", stage: this.stage });
  }

  private emitSnapshot(): void {
    if (this.stage === "qualy" && this.qualy) {
      const snapshot = this.qualy.snapshot();
      this.broadcast((driverId) => ({ type: "snapshot", stage: "qualy", snapshot, heroId: driverId }));
    } else if (this.stage === "race" && this.race) {
      const snapshot = this.race.snapshot();
      this.broadcast((driverId, conn) => ({
        type: "snapshot",
        stage: "race",
        snapshot: this.raceSnapshotForConn(snapshot, conn),
        heroId: driverId,
      }));
    }
  }

  private emitSnapshotTo(connectionId: ConnectionId): void {
    const conn = this.connections.get(connectionId);
    if (!conn || !conn.sink.isOpen()) return;
    const driverId = conn.driverId;
    if (this.stage === "qualy" && this.qualy) {
      conn.sink.send({ type: "snapshot", stage: "qualy", snapshot: this.qualy.snapshot(), heroId: driverId });
    } else if (this.stage === "race" && this.race) {
      const snapshot = this.race.snapshot();
      conn.sink.send({ type: "snapshot", stage: "race", snapshot: this.raceSnapshotForConn(snapshot, conn), heroId: driverId });
    }
  }

  // Delta-encode the race event stream per connection: keep only events newer than the
  // connection's high-water mark, then advance the mark to the engine's current counter.
  // Mutates conn.lastEventSeq as a side effect (one advance per snapshot send).
  private raceSnapshotForConn(snapshot: RaceSnapshot, conn: RoomConnection): RaceSnapshot {
    const newEvents = snapshot.events.filter((e) => e.seq > conn.lastEventSeq);
    if (newEvents.length > 0) conn.lastEventSeq = snapshot.eventSeq;
    return { ...snapshot, events: newEvents };
  }

  private emitResult(): void {
    if (!this.result) return;
    const result = this.result;
    this.broadcast((driverId) => ({ type: "result", result, heroId: driverId }));
  }

  private emitRoomState(): void {
    const players: RoomPlayer[] = [];
    for (const conn of this.connections.values()) {
      players.push({ driverId: conn.driverId, name: conn.hero.name, connected: conn.connected });
    }
    this.broadcastMsg({ type: "roomState", players, mode: this.mode });
  }
}
