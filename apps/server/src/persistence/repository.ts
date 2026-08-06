import type { PilotProfile, SkillKey } from "@f1race/race-engine";

export interface DriverProfile {
  guestId: string;
  hero: PilotProfile;
  totalXp: number;
  racesCount: number;
  // First-login gate: false for a brand-new Yandex user (forced through SetupScreen).
  // True once the user explicitly confirms their pilot, and for any pre-existing/guest profile.
  heroConfirmed: boolean;
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
}
