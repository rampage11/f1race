import type { PilotProfile, QualySnapshot, RaceResult, RaceSnapshot, TyreCompound } from "@f1race/race-engine";

export const PROTOCOL_VERSION = 1;

// "startSequence" sits between "qualy" and "race": qualy has finished, the lights-out
// mini-game (spec P2 / Phase 2) is running, and the race engine is not yet constructed.
export type Stage = "qualy" | "startSequence" | "race" | "finished";

export type RoomMode = "solo" | "multiplayer";

export type Division = "F4" | "F3" | "F2" | "F1";

export type ClientMessage =
  // `guestId` is an optional client-generated UUID (persisted in localStorage by the web
  // client). Present → load/create a persisted profile; absent → ephemeral session.
  // `authToken` is an OPTIONAL Yandex OAuth session token (issued by POST /auth/yandex/callback).
  // When present AND valid, it OVERRIDES `guestId`: the profile is resolved by its `sub`
  // (`yandex:<id>`) instead of the guest UUID. Invalid/absent → graceful fallback to guest flow.
  // NOTE: `authToken` (Yandex identity) is a DIFFERENT concept from `sessionToken` in
  // `reconnect` (room-scoped reconnection token). Do not conflate them.
  | {
      type: "hello";
      protocolVersion: number;
      hero: PilotProfile;
      guestId?: string;
      authToken?: string;
    }
  | { type: "reconnect"; sessionToken: string }
  | { type: "restart" }
  | { type: "speed"; value: number }
  | { type: "pause"; paused: boolean }
  | { type: "pit"; compound: TyreCompound }
  | { type: "cancelPit" }
  // Player's click during the lights-out start sequence. `clientTimestamp` is UX-only and
  // never used for fairness — the server measures reaction against its own clock at receipt.
  // `sequenceId` disambiguates which sequence the click targets (ignored if stale).
  | { type: "startReaction"; clientTimestamp: number; sequenceId: number };

export interface RoomPlayer {
  driverId: string;
  name: string;
  connected: boolean;
}

// Summary of a loaded/created profile, sent in `welcome` so the client can pre-fill setup
// and render a level badge. `driverRating` is the two-factor rating (level + skills) used for
// division/matchmaking; `heroConfirmed` is the first-login gate flag.
export interface DriverProfileSummary {
  guestId: string;
  hero: PilotProfile;
  level: number;
  division: Division;
  driverRating: number;
  heroConfirmed: boolean;
  totalXp: number;
  racesCount: number;
}

export type ServerMessage =
  | { type: "welcome"; driverId: string; sessionToken: string; mode: RoomMode; profile?: DriverProfileSummary }
  | { type: "stage"; stage: Stage }
  | { type: "snapshot"; stage: Stage; snapshot: QualySnapshot | RaceSnapshot; heroId: string }
  | { type: "result"; result: RaceResult; heroId: string }
  // Unicast to each human connection with a persisted profile right after `result` on finish,
  // so the client can animate XP gain, level-up and division.
  | {
      type: "progression";
      xpGained: number;
      totalXp: number;
      level: number;
      xpIntoLevel: number;
      xpForNext: number;
      division: Division;
      racesCount: number;
    }
  | { type: "roomState"; players: RoomPlayer[]; mode: RoomMode }
  // Announces the lights-out mini-game. `lightsOutAt` is a server wall-clock ms timestamp
  // (authoritative "go" instant); clients render the 5 lights and a countdown to it.
  // `sequenceId` increments per sequence (disambiguates restarts).
  | { type: "startSequence"; lightsOutAt: number; sequenceId: number }
  // Unicast to each player after the sequence resolves, so the client can show their time.
  | { type: "startResult"; driverId: string; reactionSec: number; jumpStart: boolean }
  // Phase 4 lobby: sent to a queued player on enqueue and on each match tick while they wait.
  // `division` is the player's own division; `queuedPlayers` is how many humans are currently
  // waiting in that same division; `estimatedWaitSec` is a rough hint. The lobby→room
  // transition is signalled by `welcome` arriving (no separate "matched" message).
  | { type: "lobbyState"; division: Division; queuedPlayers: number; estimatedWaitSec: number }
  | { type: "error"; message: string };

export type { PilotProfile, QualySnapshot, RaceResult, RaceSnapshot, TyreCompound };
