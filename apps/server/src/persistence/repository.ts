import type { CosmeticType, EquippedCosmetics } from "../cosmetics.js";
import type { PilotProfile, SkillKey } from "@f1race/race-engine";
export interface DriverProfile {
  guestId: string;
  hero: PilotProfile;
  totalXp: number;
  racesCount: number;
  // Earnable soft currency (S3-4). Awarded by races (applyProgression) and quest claims; spent
  // on level-gated cosmetics in /api/cosmetics/buy. Cosmetic-only — never affects gameplay.
  softCurrency?: number;
  // Equipped cosmetics per type (S3-2): { accentColor?: unlockId, carNumber?: unlockId }.
  // Only owned unlockIds may be equipped; persisted as a JSON text column on profiles.
  equippedCosmetics?: EquippedCosmetics;
  // First-login gate: false for a brand-new Yandex user (forced through SetupScreen).
  // True once the user explicitly confirms their pilot, and for any pre-existing/guest profile.
  heroConfirmed: boolean;
  // Skill respec gating (optional — older rows / in-memory construction default to "unused").
  // freeRespecUsed flips to true after the one free respec at level respec.freeLevel; lastRespecAt
  // timestamps the most recent respec for the cooldownDays gate.
  freeRespecUsed?: boolean;
  lastRespecAt?: number | null;
  // First-race tutorial: undefined/true = done (legacy users skip); explicitly false on a brand-
  // new confirmed profile means the guided tutorial is still pending and the race entry should
  // route there instead of the normal lobby flow.
  tutorialCompleted?: boolean;
  // Skill points banked from level-ups (pointsPerLevel per level gained) but not yet spent.
  // The hub shows a Level-Up modal while this is > 0; allocateSkillPoint spends them one at a
  // time. Undefined/0 for legacy rows.
  unspentSkillPoints?: number;
  // Daily-streak tracking (S2-10). `lastRaceDay` is the UTC day number of the most recent race
  // (Math.floor(Date.now()/86400000)); `streakDays` is the current consecutive-day count
  // (capped at 7). Undefined for legacy rows → treated as no streak on first race.
  lastRaceDay?: number;
  streakDays?: number;
  createdAt: number;
  updatedAt: number;
}

// Career aggregate over a profile's race_history rows (S2-5). Read-only; recomputed per call.
export interface CareerStats {
  totalRaces: number;
  wins: number;
  poles: number;
  podiums: number;
  bestFinish: number | null;
  averagePlace: number | null;
  dnfCount: number;
  totalXpGained: number;
}

export interface RaceHistoryRow {
  profileId: string;
  finishedAt: number;
  place: number;
  gridPosition: number;
  fastestLapDriverId: string | null;
  positionsGained: number;
  xpGained: number;
  dnf: boolean;
}

export interface TrainingJob {
  id: number;
  profileId: string;
  targetSkill: SkillKey;
  startedAt: number;
  durationSec: number;
  completedAt: number | null;
}

export type Division = "F4" | "F3" | "F2" | "F1";

export interface LeaderboardRow {
  rank: number;
  guestId: string;
  name: string;
  team: string;
  country: string;
  level: number;
  driverRating: number;
  racesCount: number;
  // Present on weekly-season rows: total xpGained across this week's race_history rows.
  xpGained?: number;
}

export interface LeaderboardResult {
  division: Division;
  rows: LeaderboardRow[];
  // The viewer's own rank/entry within this division (omitted if they are not in it).
  me?: LeaderboardRow;
  // Present only for ?season=current: the weekly window + a reset instant for the countdown.
  season?: { label: string; weekStart: number; weekEnd: number; resetAt: number };
}

// One assigned daily quest (S2-9). `assignedDay` is the UTC day number the quest belongs to;
// (profileId, questDefId, assignedDay) is the natural key so a quest can re-appear on a later
// day with a fresh progress counter.
export interface QuestAssignment {
  profileId: string;
  questDefId: string;
  assignedDay: number;
  progress: number;
  claimedAt: number | null;
}

// A quest row joined with its catalog definition, for the /api/quests/state response.
export interface QuestAssignmentView {
  questDefId: string;
  desc: string;
  goal: number;
  progress: number;
  claimed: boolean;
}

export interface OwnedCosmetics {
  owned: string[];
  equipped: EquippedCosmetics;
  softCurrency: number;
}

export interface DriverProfileRepository {
  get(guestId: string): DriverProfile | null;
  upsert(profile: DriverProfile): void;
  addRaceResult(row: RaceHistoryRow): void;
  recordRaceFinish(profile: DriverProfile, row: RaceHistoryRow): void;
  close(): void;
  getActiveTraining(profileId: string): TrainingJob | null;
  startTraining(profileId: string, skill: SkillKey, startedAt: number, durationSec: number): TrainingJob;
  cancelTraining(id: number): void;
  completeTraining(training: TrainingJob, profile: DriverProfile): void;
  // Top profiles in a division by driverRating (denormalized on every upsert). When
  // viewerGuestId is supplied, the viewer's own rank is computed and returned as `me`.
  leaderboard(division: Division, limit: number, viewerGuestId?: string): LeaderboardResult;
  // Weekly-season leaderboard (S3-1): SUM(xpGained) from race_history within [weekStart, weekEnd]
  // per profile in the division, ORDER BY gain desc. `season` carries the label/reset for the UI.
  weeklyLeaderboard(
    division: Division,
    weekStart: number,
    weekEnd: number,
    limit: number,
    season: { label: string; weekStart: number; weekEnd: number; resetAt: number },
    viewerGuestId?: string,
  ): LeaderboardResult;
  // Flip tutorialCompleted=true and award the one-time tutorial XP bonus in one transaction.
  markTutorialCompleted(profile: DriverProfile, xpBonus: number): void;
  // Spend one banked level-up skill point on `skill` (clamped at the absolute cap). No-op
  // (returns false) when there are no unspent points or the skill is already maxed.
  allocateSkillPoint(profile: DriverProfile, skill: SkillKey): boolean;
  // Read-only career aggregate over a profile's race_history rows (S2-5 stats route).
  getStats(profileId: string): CareerStats;

  // --- Daily quests (S2-9) ---
  // Read today's (UTC day) quest assignments for a profile (oldest-first). Does NOT assign.
  getActiveQuests(profileId: string, assignedDay: number): QuestAssignment[];
  // Idempotently assign 3 daily quests for the current UTC day if none assigned yet today.
  // Returns the resulting assignment rows (whether freshly created or pre-existing).
  assignDailyQuests(profileId: string, assignedDay: number, questDefIds: string[]): QuestAssignment[];
  // Bump progress on (profileId, questDefId, assignedDay) by `delta`, capped at goal? — the
  // repo does NOT cap (claim checks goal>=); a no-op if no such assignment exists today.
  incrementQuestProgress(profileId: string, questDefId: string, assignedDay: number, delta: number): void;
  // Atomically mark a quest claimed and return its row, or null if it isn't complete / already
  // claimed / not assigned today. The caller awards xp + currency from the quest def.
  claimQuest(profileId: string, questDefId: string, assignedDay: number, goal: number): QuestAssignment | null;

  // --- Cosmetics (S3-2 / S3-4) ---
  getOwnedCosmetics(profileId: string): OwnedCosmetics;
  // Insert an owned unlock idempotently (no-op if already owned). Does NOT deduct currency —
  // the caller (route) validates + deducts softCurrency before calling.
  addOwnedCosmetic(profileId: string, unlockId: string): void;
  // True when the profile already owns this unlockId (equip/buy guard).
  hasOwnedCosmetic(profileId: string, unlockId: string): boolean;

  // Lightweight DB-readable probe for /health (S3-6). Throws/returns false when unreachable.
  ping(): boolean;
}
