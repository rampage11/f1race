import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ABSOLUTE_SKILL_MAX, clampSkill, divisionForRating, driverRating, levelFromXp, skillSum, type PilotProfile, type SkillKey } from "@f1race/race-engine";
import type {
  Division,
  DriverProfile,
  DriverProfileRepository,
  LeaderboardResult,
  LeaderboardRow,
  RaceHistoryRow,
  TrainingJob,
} from "./repository.js";

interface ProfileRow {
  guestId: string;
  hero: string;
  totalXp: number;
  racesCount: number;
  heroConfirmed: number;
  freeRespecUsed: number;
  lastRespecAt: number | null;
  level: number;
  driverRating: number;
  division: string | null;
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

interface TrainingRow {
  id: number;
  profileId: string;
  targetSkill: string;
  startedAt: number;
  durationSec: number;
  completedAt: number | null;
}

interface LeaderboardQueryRow {
  guestId: string;
  hero: string;
  totalXp: number;
  racesCount: number;
  level: number;
  driverRating: number;
}

interface ViewerQueryRow extends LeaderboardQueryRow {
  division: string | null;
  heroConfirmed: number;
}

function toLeaderboardRow(r: LeaderboardQueryRow, rank: number): LeaderboardRow {
  const hero = JSON.parse(r.hero) as PilotProfile;
  return {
    rank,
    guestId: r.guestId,
    name: hero.name,
    team: hero.team,
    country: hero.country,
    level: r.level,
    driverRating: r.driverRating,
    racesCount: r.racesCount,
  };
}

function toProfile(r: ProfileRow): DriverProfile {
  return {
    guestId: r.guestId,
    hero: JSON.parse(r.hero) as PilotProfile,
    totalXp: r.totalXp,
    racesCount: r.racesCount,
    heroConfirmed: r.heroConfirmed !== 0,
    freeRespecUsed: r.freeRespecUsed !== 0,
    lastRespecAt: r.lastRespecAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toTraining(r: TrainingRow): TrainingJob {
  return {
    id: r.id,
    profileId: r.profileId,
    targetSkill: r.targetSkill as SkillKey,
    startedAt: r.startedAt,
    durationSec: r.durationSec,
    completedAt: r.completedAt,
  };
}

export class SqliteDriverProfileRepository implements DriverProfileRepository {
  private db: Database.Database;
  private stmtGet: Database.Statement;
  private stmtUpsert: Database.Statement;
  private stmtAddRace: Database.Statement;
  private stmtHistory: Database.Statement;
  private txFinish: (profile: DriverProfile, row: RaceHistoryRow) => void;
  private stmtGetActiveTraining: Database.Statement;
  private stmtStartTraining: Database.Statement;
  private stmtGetTrainingById: Database.Statement;
  private stmtCancelTraining: Database.Statement;
  private stmtLeaderboard: Database.Statement;
  private stmtViewerRow: Database.Statement;
  private stmtViewerRank: Database.Statement;
  private txCompleteTraining: (training: TrainingJob, profile: DriverProfile) => void;

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
      CREATE TABLE IF NOT EXISTS trainings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profileId TEXT NOT NULL,
        targetSkill TEXT NOT NULL,
        startedAt INTEGER NOT NULL,
        durationSec INTEGER NOT NULL,
        completedAt INTEGER,
        FOREIGN KEY (profileId) REFERENCES profiles(guestId)
      );
    `);
    // Idempotent column migration: pre-existing profiles tables predate heroConfirmed.
    // A profile that already existed is treated as already confirmed (DEFAULT 1) so legacy
    // players are not re-gated through SetupScreen; only brand-new Yandex users start at 0.
    const cols = this.db.pragma("table_info(profiles)") as { name: string }[];
    if (!cols.some((c) => c.name === "heroConfirmed")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN heroConfirmed INTEGER NOT NULL DEFAULT 1");
    }
    if (!cols.some((c) => c.name === "freeRespecUsed")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN freeRespecUsed INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.some((c) => c.name === "lastRespecAt")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN lastRespecAt INTEGER");
    }
    // Denormalized ranking columns for the leaderboard (computed on every upsert so the
    // top-N query can ORDER BY driverRating without re-deriving level/rating from the hero
    // JSON + totalXp in SQL). Existing rows default to 0/NULL and populate on next play.
    if (!cols.some((c) => c.name === "driverRating")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN level INTEGER NOT NULL DEFAULT 0");
      this.db.exec("ALTER TABLE profiles ADD COLUMN driverRating INTEGER NOT NULL DEFAULT 0");
      this.db.exec("ALTER TABLE profiles ADD COLUMN division TEXT");
    }
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_profiles_division_rating ON profiles(division, driverRating DESC, totalXp DESC)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_trainings_profile ON trainings(profileId, completedAt)",
    );

    this.stmtGet = this.db.prepare("SELECT * FROM profiles WHERE guestId = ?");
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO profiles (guestId, hero, totalXp, racesCount, heroConfirmed, freeRespecUsed, lastRespecAt, level, driverRating, division, createdAt, updatedAt)
      VALUES (@guestId, @hero, @totalXp, @racesCount, @heroConfirmed, @freeRespecUsed, @lastRespecAt, @level, @driverRating, @division, @createdAt, @updatedAt)
      ON CONFLICT(guestId) DO UPDATE SET
        hero = excluded.hero,
        totalXp = excluded.totalXp,
        racesCount = excluded.racesCount,
        heroConfirmed = excluded.heroConfirmed,
        freeRespecUsed = excluded.freeRespecUsed,
        lastRespecAt = excluded.lastRespecAt,
        level = excluded.level,
        driverRating = excluded.driverRating,
        division = excluded.division,
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

    this.stmtGetActiveTraining = this.db.prepare(
      "SELECT * FROM trainings WHERE profileId = ? AND completedAt IS NULL ORDER BY startedAt DESC LIMIT 1",
    );
    this.stmtStartTraining = this.db.prepare(`
      INSERT INTO trainings (profileId, targetSkill, startedAt, durationSec, completedAt)
      VALUES (@profileId, @targetSkill, @startedAt, @durationSec, NULL)
    `);
    this.stmtGetTrainingById = this.db.prepare("SELECT * FROM trainings WHERE id = ?");
    this.stmtCancelTraining = this.db.prepare("DELETE FROM trainings WHERE id = ?");
    const markComplete = this.db.prepare(
      "UPDATE trainings SET completedAt = ? WHERE id = ?",
    );
    this.txCompleteTraining = this.db.transaction((training: TrainingJob, profile: DriverProfile) => {
      const skill = training.targetSkill;
      const next = clampSkill(profile.hero.skills[skill] + 1);
      const leveledUp = next > profile.hero.skills[skill];
      if (leveledUp) {
        const hero: PilotProfile = {
          ...profile.hero,
          skills: { ...profile.hero.skills, [skill]: next },
        };
        profile.hero = hero;
      }
      profile.updatedAt = training.startedAt + training.durationSec;
      upsert.run(this.profileParams(profile));
      markComplete.run(profile.updatedAt, training.id);
    });

    this.stmtLeaderboard = this.db.prepare(
      `SELECT guestId, hero, totalXp, racesCount, level, driverRating FROM profiles
       WHERE division = ? AND heroConfirmed = 1
       ORDER BY driverRating DESC, totalXp DESC, racesCount DESC, guestId ASC LIMIT ?`,
    );
    this.stmtViewerRow = this.db.prepare(
      `SELECT guestId, hero, totalXp, racesCount, level, driverRating, division, heroConfirmed FROM profiles
       WHERE guestId = ?`,
    );
    this.stmtViewerRank = this.db.prepare(
      `SELECT COUNT(*) + 1 AS rank FROM profiles
       WHERE division = ? AND heroConfirmed = 1 AND (
         driverRating > ? OR (driverRating = ? AND totalXp > ?)
       )`,
    );
  }

  private profileParams(profile: DriverProfile) {
    const level = levelFromXp(profile.totalXp);
    const rating = driverRating(level, skillSum(profile.hero.skills));
    const division = divisionForRating(rating);
    return {
      guestId: profile.guestId,
      hero: JSON.stringify(profile.hero),
      totalXp: profile.totalXp,
      racesCount: profile.racesCount,
      heroConfirmed: profile.heroConfirmed ? 1 : 0,
      freeRespecUsed: (profile.freeRespecUsed ?? false) ? 1 : 0,
      lastRespecAt: profile.lastRespecAt ?? null,
      level,
      driverRating: rating,
      division,
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

  getActiveTraining(profileId: string): TrainingJob | null {
    const r = this.stmtGetActiveTraining.get(profileId) as TrainingRow | undefined;
    return r ? toTraining(r) : null;
  }

  startTraining(profileId: string, skill: SkillKey, startedAt: number, durationSec: number): TrainingJob {
    const info = this.stmtStartTraining.run({ profileId, targetSkill: skill, startedAt, durationSec });
    const r = this.stmtGetTrainingById.get(Number(info.lastInsertRowid)) as TrainingRow;
    return toTraining(r);
  }

  cancelTraining(id: number): void {
    this.stmtCancelTraining.run(id);
  }

  completeTraining(training: TrainingJob, profile: DriverProfile): void {
    this.txCompleteTraining(training, profile);
  }

  leaderboard(division: Division, limit: number, viewerGuestId?: string): LeaderboardResult {
    const capped = Math.max(1, Math.min(100, Math.floor(limit)));
    const top = this.stmtLeaderboard.all(division, capped) as LeaderboardQueryRow[];
    const rows: LeaderboardRow[] = top.map((r, i) => toLeaderboardRow(r, i + 1));
    let me: LeaderboardRow | undefined;
    if (viewerGuestId) {
      const v = this.stmtViewerRow.get(viewerGuestId) as ViewerQueryRow | undefined;
      if (v && v.division === division && v.heroConfirmed !== 0) {
        const rankRow = this.stmtViewerRank.get(division, v.driverRating, v.driverRating, v.totalXp) as { rank: number };
        me = toLeaderboardRow(v, rankRow.rank);
      }
    }
    return me ? { division, rows, me } : { division, rows };
  }

  close(): void {
    this.db.close();
  }
}

export const TRAINING_SKILL_CEILING = ABSOLUTE_SKILL_MAX;
