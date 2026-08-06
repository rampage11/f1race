import type { PilotProfile } from "@f1race/race-engine";

export interface DriverProfile {
  guestId: string;
  hero: PilotProfile;
  totalXp: number;
  racesCount: number;
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

export interface DriverProfileRepository {
  get(guestId: string): DriverProfile | null;
  upsert(profile: DriverProfile): void;
  addRaceResult(row: RaceHistoryRow): void;
  recordRaceFinish(profile: DriverProfile, row: RaceHistoryRow): void;
  close(): void;
}
