import type { PilotProfile, SkillKey } from "@f1race/race-engine";

export interface DriverProfile {
  guestId: string;
  hero: PilotProfile;
  totalXp: number;
  racesCount: number;
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
  // route there instead of the normal lobby.
  tutorialCompleted?: boolean;
  createdAt: number;
  updatedAt: number;
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
}

export interface LeaderboardResult {
  division: Division;
  rows: LeaderboardRow[];
  // The viewer's own rank/entry within this division (omitted if they are not in it).
  me?: LeaderboardRow;
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
  // Flip tutorialCompleted=true and award the one-time tutorial XP bonus in one transaction.
  markTutorialCompleted(profile: DriverProfile, xpBonus: number): void;
}
