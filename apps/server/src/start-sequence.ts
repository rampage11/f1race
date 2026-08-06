// Server-authoritative "lights out" start mini-game (spec P2 / Phase 2).
// Pure helpers + tuning constants — no I/O, fully unit-testable.

// Qualy-finish → lights-out gap. Allows ~5 lights illuminating ~1s apart + a short hold
// before the random-ish "lights out" instant that clients render a countdown to.
export const START_SEQUENCE_DELAY_MS = 6000;

// Hard deadline after lights out. Players who do not send startReaction within this
// window get START_LATE_REACTION_SEC. Also caps how long the room waits before resolving
// when not every human has reacted. Reactions are measured against the server clock at
// receipt, never the client timestamp (fairness across pings — spec P2).
export const REACTION_WINDOW_MS = 4000;

// Effective reactionTimeSec assigned to a jump start (click received BEFORE lights out).
// Baked into the driver's reactionTimeSec as a deterministic time penalty; worse than any
// legit slow reaction and worse than not reacting at all.
export const START_JUMP_START_REACTION_SEC = 2.0;

// Effective reactionTimeSec assigned when no startReaction arrives within the window
// (late / AFK / disconnected). Represents a stalled launch.
export const START_LATE_REACTION_SEC = 1.5;

// Floor for a measured reaction: clamps sub-human / near-zero positive deltas so the
// engine's own false-start floor (CONFIG.start.falseStartRt = 0.04) is never triggered by
// a legit fast click that arrived a few ms after lights out.
export const START_MIN_REACTION_SEC = 0.05;

// Ceiling for a measured reaction: caps absurdly slow valid reactions to the same value
// assigned to a complete non-reaction, so "reacted very slowly" is never punished harder
// than "did not react at all".
export const START_MAX_REACTION_SEC = 1.5;

export interface ResolveReactionOptions {
  jumpStartPenaltySec: number;
  minReactionSec: number;
  maxReactionSec: number;
}

export interface ResolvedReaction {
  reactionSec: number;
  jumpStart: boolean;
}

/**
 * Convert a server-receipt timestamp into an effective reactionTimeSec for a driver.
 *
 * Timing is server-authoritative: `serverReceiptMs` is when the server processed the
 * player's click; `lightsOutAtMs` is the authoritative "go" instant. The client timestamp
 * is intentionally NOT used for any penalty (spec P2) — it is UX-only.
 *
 * - Jump start (serverReceiptMs < lightsOutAtMs): returns the fixed penalty.
 * - Otherwise: (serverReceiptMs - lightsOutAtMs) / 1000, clamped to [min, max].
 */
export function resolveEffectiveReactionSec(
  serverReceiptMs: number,
  lightsOutAtMs: number,
  opts: ResolveReactionOptions,
): ResolvedReaction {
  const deltaMs = serverReceiptMs - lightsOutAtMs;
  if (deltaMs < 0) {
    return { reactionSec: opts.jumpStartPenaltySec, jumpStart: true };
  }
  const rawSec = deltaMs / 1000;
  const reactionSec = Math.max(opts.minReactionSec, Math.min(opts.maxReactionSec, rawSec));
  return { reactionSec, jumpStart: false };
}

export const DEFAULT_REACTION_OPTIONS: ResolveReactionOptions = {
  jumpStartPenaltySec: START_JUMP_START_REACTION_SEC,
  minReactionSec: START_MIN_REACTION_SEC,
  maxReactionSec: START_MAX_REACTION_SEC,
};
