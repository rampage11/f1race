import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PilotProfile } from "@f1race/race-engine";
import type {
  DriverProfile,
  DriverProfileRepository,
  RaceHistoryRow,
} from "./repository.js";

interface ProfileRow {
  guestId: string;
  hero: string;
  totalXp: number;
  racesCount: number;
  createdAt: number;
  updatedAt: number;
}

interface HistoryRow {
  profileId: string;
  finishedAt: number;
  place: number;
  gridPosition: number;
  fastestLapDriverId: string | null;
  positionsGained: number;
  xpGained: number;
  dnf: number;
}

function toProfile(r: ProfileRow): DriverProfile {
  return {
    guestId: r.guestId,
    hero: JSON.parse(r.hero) as PilotProfile,
    totalXp: r.totalXp,
    racesCount: r.racesCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class SqliteDriverProfileRepository implements DriverProfileRepository {
  private db: Database.Database;
  private stmtGet: Database.Statement;
  private stmtUpsert: Database.Statement;
  private stmtAddRace: Database.Statement;
  private stmtHistory: Database.Statement;
  private txFinish: (profile: DriverProfile, row: RaceHistoryRow) => void;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    // WAL: better concurrent read throughput; safe for a single-process server.
    // synchronous=NORMAL: durable enough for a game profile store, faster fsync cadence.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        guestId TEXT PRIMARY KEY,
        hero TEXT NOT NULL,
        totalXp INTEGER NOT NULL,
        racesCount INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS race_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profileId TEXT NOT NULL,
        finishedAt INTEGER NOT NULL,
        place INTEGER NOT NULL,
        gridPosition INTEGER NOT NULL,
        fastestLapDriverId TEXT,
        positionsGained INTEGER NOT NULL,
        xpGained INTEGER NOT NULL,
        dnf INTEGER NOT NULL,
        FOREIGN KEY (profileId) REFERENCES profiles(guestId)
      );
    `);
    this.stmtGet = this.db.prepare("SELECT * FROM profiles WHERE guestId = ?");
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO profiles (guestId, hero, totalXp, racesCount, createdAt, updatedAt)
      VALUES (@guestId, @hero, @totalXp, @racesCount, @createdAt, @updatedAt)
      ON CONFLICT(guestId) DO UPDATE SET
        hero = excluded.hero,
        totalXp = excluded.totalXp,
        racesCount = excluded.racesCount,
        updatedAt = excluded.updatedAt
    `);
    this.stmtAddRace = this.db.prepare(`
      INSERT INTO race_history
        (profileId, finishedAt, place, gridPosition, fastestLapDriverId, positionsGained, xpGained, dnf)
      VALUES
        (@profileId, @finishedAt, @place, @gridPosition, @fastestLapDriverId, @positionsGained, @xpGained, @dnf)
    `);
    this.stmtHistory = this.db.prepare(
      "SELECT * FROM race_history WHERE profileId = ? ORDER BY finishedAt DESC",
    );
    const upsert = this.stmtUpsert;
    const addRace = this.stmtAddRace;
    this.txFinish = this.db.transaction((profile: DriverProfile, row: RaceHistoryRow) => {
      upsert.run(this.profileParams(profile));
      addRace.run(this.historyParams(row));
    });
  }

  private profileParams(profile: DriverProfile) {
    return {
      guestId: profile.guestId,
      hero: JSON.stringify(profile.hero),
      totalXp: profile.totalXp,
      racesCount: profile.racesCount,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private historyParams(row: RaceHistoryRow) {
    return {
      profileId: row.profileId,
      finishedAt: row.finishedAt,
      place: row.place,
      gridPosition: row.gridPosition,
      fastestLapDriverId: row.fastestLapDriverId,
      positionsGained: row.positionsGained,
      xpGained: row.xpGained,
      dnf: row.dnf ? 1 : 0,
    };
  }

  get(guestId: string): DriverProfile | null {
    const r = this.stmtGet.get(guestId) as ProfileRow | undefined;
    return r ? toProfile(r) : null;
  }

  upsert(profile: DriverProfile): void {
    this.stmtUpsert.run(this.profileParams(profile));
  }

  addRaceResult(row: RaceHistoryRow): void {
    this.stmtAddRace.run(this.historyParams(row));
  }

  recordRaceFinish(profile: DriverProfile, row: RaceHistoryRow): void {
    this.txFinish(profile, row);
  }

  history(profileId: string): Omit<RaceHistoryRow, never>[] {
    const rows = this.stmtHistory.all(profileId) as HistoryRow[];
    return rows.map((r) => ({
      profileId: r.profileId,
      finishedAt: r.finishedAt,
      place: r.place,
      gridPosition: r.gridPosition,
      fastestLapDriverId: r.fastestLapDriverId,
      positionsGained: r.positionsGained,
      xpGained: r.xpGained,
      dnf: r.dnf !== 0,
    }));
  }

  close(): void {
    this.db.close();
  }
}
