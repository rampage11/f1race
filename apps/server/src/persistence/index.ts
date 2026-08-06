import { SqliteDriverProfileRepository } from "./sqlite-repository.js";
import type { DriverProfile, DriverProfileRepository, RaceHistoryRow } from "./repository.js";

export function createRepository(dbPath: string): DriverProfileRepository {
  return new SqliteDriverProfileRepository(dbPath);
}

export type { DriverProfile, DriverProfileRepository, RaceHistoryRow };
