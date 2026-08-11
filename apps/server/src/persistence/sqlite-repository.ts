import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ABSOLUTE_SKILL_MAX, clampSkill, divisionForRating, driverRating, levelFromXp, levelUpPointsAccrued, skillSum, type PilotProfile, type SkillKey } from "@f1race/race-engine";
import { parseEquipped, serializeEquipped } from "../cosmetics.js";
import type {
  CareerStats,
  Division,
  DriverProfile,
  DriverProfileRepository,
  LeaderboardResult,
  LeaderboardRow,
  OwnedCosmetics,
  QuestAssignment,
  QuestAssignmentView,
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
  tutorialCompleted: number;
  unspentSkillPoints: number;
  lastRaceDay: number | null;
  streakDays: number;
  softCurrency: number;
  equippedCosmetics: string | null;
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

interface StatsAggregateRow {
  totalRaces: number;
  wins: number;
  poles: number;
  podiums: number;
  bestFinish: number | null;
  avgPlaceSum: number;
  avgPlaceNonDnf: number;
  dnfCount: number;
  totalXpGained: number;
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
  xpGain?: number;
}

interface ViewerQueryRow extends LeaderboardQueryRow {
  division: string | null;
  heroConfirmed: number;
}

interface QuestRow {
  profileId: string;
  questDefId: string;
  assignedDay: number;
  progress: number;
  claimedAt: number | null;
}

function toQuest(r: QuestRow): QuestAssignment {
  return {
    profileId: r.profileId,
    questDefId: r.questDefId,
    assignedDay: r.assignedDay,
    progress: r.progress,
    claimedAt: r.claimedAt,
  };
}

function toLeaderboardRow(r: LeaderboardQueryRow, rank: number): LeaderboardRow {
  const hero = JSON.parse(r.hero) as PilotProfile;
  const row: LeaderboardRow = {
    rank,
    guestId: r.guestId,
    name: hero.name,
    team: hero.team,
    country: hero.country,
    level: r.level,
    driverRating: r.driverRating,
    racesCount: r.racesCount,
  };
  if (typeof r.xpGain === "number") row.xpGained = r.xpGain;
  return row;
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
    tutorialCompleted: r.tutorialCompleted !== 0,
    unspentSkillPoints: r.unspentSkillPoints,
    lastRaceDay: r.lastRaceDay ?? undefined,
    streakDays: r.streakDays ?? undefined,
    softCurrency: r.softCurrency ?? 0,
    equippedCosmetics: parseEquipped(r.equippedCosmetics),
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
  private stmtStats: Database.Statement;
  private stmtPing: Database.Statement;
  private txCompleteTraining: (training: TrainingJob, profile: DriverProfile) => void;
  private stmtWeeklyLeaderboard: Database.Statement;
  private stmtWeeklyViewerRow: Database.Statement;
  private stmtWeeklyViewerRank: Database.Statement;
  private stmtGetActiveQuests: Database.Statement;
  private stmtGetOneQuest: Database.Statement;
  private stmtInsertQuest: Database.Statement;
  private stmtIncQuest: Database.Statement;
  private stmtClaimQuest: Database.Statement;
  private stmtOwnedCosmetics: Database.Statement;
  private stmtHasCosmetic: Database.Statement;
  private stmtInsertCosmetic: Database.Statement;

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
      CREATE TABLE IF NOT EXISTS quests (
        profileId TEXT NOT NULL,
        questDefId TEXT NOT NULL,
        assignedDay INTEGER NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        claimedAt INTEGER,
        PRIMARY KEY(profileId, questDefId, assignedDay)
      );
      CREATE TABLE IF NOT EXISTS unlocks (
        profileId TEXT NOT NULL,
        unlockId TEXT NOT NULL,
        PRIMARY KEY(profileId, unlockId)
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
    // tutorialCompleted defaults to 1 so legacy/existing players skip the guided tutorial;
    // only brand-new confirmed profiles start at 0 (set in their creation paths).
    if (!cols.some((c) => c.name === "tutorialCompleted")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN tutorialCompleted INTEGER NOT NULL DEFAULT 1");
    }
    if (!cols.some((c) => c.name === "unspentSkillPoints")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN unspentSkillPoints INTEGER NOT NULL DEFAULT 0");
    }
    // S2-10 daily streak columns. lastRaceDay is the UTC day number of the most recent race;
    // streakDays the consecutive-day count (capped at 7). NULL/0 for legacy rows → no streak
    // until the first new race populates them.
    if (!cols.some((c) => c.name === "lastRaceDay")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN lastRaceDay INTEGER");
    }
    if (!cols.some((c) => c.name === "streakDays")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN streakDays INTEGER NOT NULL DEFAULT 0");
    }
    // S3-4 earnable soft currency. Default 0; awarded by races/quests, spent on cosmetics.
    if (!cols.some((c) => c.name === "softCurrency")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN softCurrency INTEGER NOT NULL DEFAULT 0");
    }
    // S3-2 equipped cosmetics map (JSON text: { accentColor?: id, carNumber?: id }). NULL/empty
    // for legacy rows → nothing equipped (the client falls back to defaults).
    if (!cols.some((c) => c.name === "equippedCosmetics")) {
      this.db.exec("ALTER TABLE profiles ADD COLUMN equippedCosmetics TEXT");
    }
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_profiles_division_rating ON profiles(division, driverRating DESC, totalXp DESC)",
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_trainings_profile ON trainings(profileId, completedAt)",
    );
    // Weekly leaderboard lookup: race_history rows in a week for one division's profiles.
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_race_history_finished ON race_history(finishedAt)",
    );

    this.stmtGet = this.db.prepare("SELECT * FROM profiles WHERE guestId = ?");
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO profiles (guestId, hero, totalXp, racesCount, heroConfirmed, freeRespecUsed, lastRespecAt, tutorialCompleted, unspentSkillPoints, lastRaceDay, streakDays, softCurrency, equippedCosmetics, level, driverRating, division, createdAt, updatedAt)
      VALUES (@guestId, @hero, @totalXp, @racesCount, @heroConfirmed, @freeRespecUsed, @lastRespecAt, @tutorialCompleted, @unspentSkillPoints, @lastRaceDay, @streakDays, @softCurrency, @equippedCosmetics, @level, @driverRating, @division, @createdAt, @updatedAt)
      ON CONFLICT(guestId) DO UPDATE SET
        hero = excluded.hero,
        totalXp = excluded.totalXp,
        racesCount = excluded.racesCount,
        heroConfirmed = excluded.heroConfirmed,
        freeRespecUsed = excluded.freeRespecUsed,
        lastRespecAt = excluded.lastRespecAt,
        tutorialCompleted = excluded.tutorialCompleted,
        unspentSkillPoints = excluded.unspentSkillPoints,
        lastRaceDay = excluded.lastRaceDay,
        streakDays = excluded.streakDays,
        softCurrency = excluded.softCurrency,
        equippedCosmetics = excluded.equippedCosmetics,
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
    // S2-5 career aggregate over race_history. AVG/MIN over finishers only (dnf=0) so a
    // DSQ does not pollute the average finish / best finish; place IS NOT NULL excludes
    // pre-migration oddities. NULLIF/MIN handles an empty table (no rows → NULL/0).
    this.stmtStats = this.db.prepare(
      `SELECT
         COUNT(*) AS totalRaces,
         COALESCE(SUM(CASE WHEN place = 1 THEN 1 ELSE 0 END), 0) AS wins,
         COALESCE(SUM(CASE WHEN gridPosition = 1 THEN 1 ELSE 0 END), 0) AS poles,
         COALESCE(SUM(CASE WHEN place <= 3 THEN 1 ELSE 0 END), 0) AS podiums,
         MIN(place) AS bestFinish,
         COALESCE(SUM(CASE WHEN dnf = 0 THEN place ELSE 0 END), 0) AS avgPlaceSum,
         COALESCE(SUM(CASE WHEN dnf = 0 THEN 1 ELSE 0 END), 0) AS avgPlaceNonDnf,
         COALESCE(SUM(CASE WHEN dnf = 1 THEN 1 ELSE 0 END), 0) AS dnfCount,
         COALESCE(SUM(xpGained), 0) AS totalXpGained
       FROM race_history
       WHERE profileId = ?`,
    );
    this.stmtPing = this.db.prepare("SELECT 1");

    // S3-1 weekly leaderboard: SUM(xpGained) over race_history within the week, joined to
    // profiles for division/hero/level. Ordered by gain desc, then driverRating as a tiebreak
    // so an established pilot edges out a brand-new one on equal weekly XP.
    // Positional ? placeholders (better-sqlite3 only accepts @/$/: named params or
    // positional ? — never the bare ?name form the prior draft used, which threw at prepare).
    this.stmtWeeklyLeaderboard = this.db.prepare(
      `SELECT rh.profileId AS guestId, p.hero AS hero, p.totalXp AS totalXp,
              p.racesCount AS racesCount, p.level AS level, p.driverRating AS driverRating,
              COALESCE(SUM(rh.xpGained), 0) AS xpGain
       FROM race_history rh
       JOIN profiles p ON p.guestId = rh.profileId
       WHERE rh.finishedAt >= ? AND rh.finishedAt <= ?
         AND p.division = ? AND p.heroConfirmed = 1
       GROUP BY rh.profileId
       ORDER BY xpGain DESC, p.driverRating DESC, p.totalXp DESC, rh.profileId ASC
       LIMIT ?`,
    );
    this.stmtWeeklyViewerRow = this.db.prepare(
      `SELECT rh.profileId AS guestId, p.hero AS hero, p.totalXp AS totalXp,
              p.racesCount AS racesCount, p.level AS level, p.driverRating AS driverRating,
              COALESCE(SUM(rh.xpGained), 0) AS xpGain
       FROM race_history rh
       JOIN profiles p ON p.guestId = rh.profileId
       WHERE rh.finishedAt >= ? AND rh.finishedAt <= ?
         AND rh.profileId = ?
       GROUP BY rh.profileId`,
    );
    this.stmtWeeklyViewerRank = this.db.prepare(
      `SELECT COUNT(*) + 1 AS rank FROM (
         SELECT rh.profileId AS gid, COALESCE(SUM(rh.xpGained), 0) AS gain
         FROM race_history rh
         JOIN profiles p ON p.guestId = rh.profileId
         WHERE rh.finishedAt >= ? AND rh.finishedAt <= ?
           AND p.division = ? AND p.heroConfirmed = 1
         GROUP BY rh.profileId
         HAVING gain > ? OR (gain = ? AND rh.profileId < ?)
       )`,
    );

    // S2-9 daily quests.
    this.stmtGetActiveQuests = this.db.prepare(
      "SELECT * FROM quests WHERE profileId = ? AND assignedDay = ? ORDER BY questDefId ASC",
    );
    this.stmtGetOneQuest = this.db.prepare(
      "SELECT * FROM quests WHERE profileId = ? AND questDefId = ? AND assignedDay = ?",
    );
    this.stmtInsertQuest = this.db.prepare(
      "INSERT OR IGNORE INTO quests (profileId, questDefId, assignedDay, progress, claimedAt) VALUES (?, ?, ?, 0, NULL)",
    );
    this.stmtIncQuest = this.db.prepare(
      "UPDATE quests SET progress = progress + ? WHERE profileId = ? AND questDefId = ? AND assignedDay = ? AND claimedAt IS NULL",
    );
    this.stmtClaimQuest = this.db.prepare(
      "UPDATE quests SET claimedAt = ? WHERE profileId = ? AND questDefId = ? AND assignedDay = ? AND claimedAt IS NULL AND progress >= ?",
    );

    // S3-2 / S3-4 cosmetics.
    this.stmtOwnedCosmetics = this.db.prepare(
      "SELECT unlockId FROM unlocks WHERE profileId = ? ORDER BY unlockId ASC",
    );
    this.stmtHasCosmetic = this.db.prepare(
      "SELECT 1 FROM unlocks WHERE profileId = ? AND unlockId = ?",
    );
    this.stmtInsertCosmetic = this.db.prepare(
      "INSERT OR IGNORE INTO unlocks (profileId, unlockId) VALUES (?, ?)",
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
      tutorialCompleted: (profile.tutorialCompleted ?? true) ? 1 : 0,
      unspentSkillPoints: profile.unspentSkillPoints ?? 0,
      lastRaceDay: profile.lastRaceDay ?? null,
      streakDays: profile.streakDays ?? 0,
      softCurrency: profile.softCurrency ?? 0,
      equippedCosmetics: serializeEquipped(profile.equippedCosmetics ?? {}),
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

  weeklyLeaderboard(
    division: Division,
    weekStart: number,
    weekEnd: number,
    limit: number,
    season: { label: string; weekStart: number; weekEnd: number; resetAt: number },
    viewerGuestId?: string,
  ): LeaderboardResult {
    const capped = Math.max(1, Math.min(100, Math.floor(limit)));
    const top = this.stmtWeeklyLeaderboard.all(weekStart, weekEnd, division, capped) as
      | LeaderboardQueryRow[]
      | undefined;
    const rows: LeaderboardRow[] = (top ?? []).map((r, i) => toLeaderboardRow(r, i + 1));
    let me: LeaderboardRow | undefined;
    if (viewerGuestId) {
      const v = this.stmtWeeklyViewerRow.get(weekStart, weekEnd, viewerGuestId) as
        | (LeaderboardQueryRow & { division?: string | null })
        | undefined;
      // Confirm the viewer is in this division (the weekly viewer row intentionally does not
      // filter by division so we can detect "raced but wrong division" cleanly).
      const vDiv = this.stmtViewerRow.get(viewerGuestId) as ViewerQueryRow | undefined;
      if (v && vDiv && vDiv.division === division && vDiv.heroConfirmed !== 0) {
        const myGain = v.xpGain ?? 0;
        const rankRow = this.stmtWeeklyViewerRank.get(
          weekStart,
          weekEnd,
          division,
          myGain,
          myGain,
          viewerGuestId,
        ) as { rank: number } | undefined;
        const rank = rankRow?.rank ?? 1;
        me = toLeaderboardRow(v, rank);
      }
    }
    return me ? { division, rows, me, season } : { division, rows, season };
  }

  markTutorialCompleted(profile: DriverProfile, xpBonus: number): void {
    const oldXp = profile.totalXp;
    profile.tutorialCompleted = true;
    profile.totalXp += xpBonus;
    profile.unspentSkillPoints = (profile.unspentSkillPoints ?? 0) + levelUpPointsAccrued(oldXp, profile.totalXp);
    profile.updatedAt = Date.now();
    this.upsert(profile);
  }

  allocateSkillPoint(profile: DriverProfile, skill: SkillKey): boolean {
    const banked = profile.unspentSkillPoints ?? 0;
    if (banked <= 0) return false;
    const current = profile.hero.skills[skill];
    if (current >= ABSOLUTE_SKILL_MAX) return false;
    profile.hero = {
      ...profile.hero,
      skills: { ...profile.hero.skills, [skill]: current + 1 },
    };
    profile.unspentSkillPoints = banked - 1;
    profile.updatedAt = Date.now();
    this.upsert(profile);
    return true;
  }

  getStats(profileId: string): CareerStats {
    const r = this.stmtStats.get(profileId) as StatsAggregateRow;
    const total = r.totalRaces ?? 0;
    const nonDnf = r.avgPlaceNonDnf ?? 0;
    return {
      totalRaces: total,
      wins: r.wins ?? 0,
      poles: r.poles ?? 0,
      podiums: r.podiums ?? 0,
      bestFinish: r.bestFinish ?? null,
      averagePlace: nonDnf > 0 ? r.avgPlaceSum / nonDnf : null,
      dnfCount: r.dnfCount ?? 0,
      totalXpGained: r.totalXpGained ?? 0,
    };
  }

  getActiveQuests(profileId: string, assignedDay: number): QuestAssignment[] {
    const rows = this.stmtGetActiveQuests.all(profileId, assignedDay) as QuestRow[];
    return rows.map(toQuest);
  }

  assignDailyQuests(profileId: string, assignedDay: number, questDefIds: string[]): QuestAssignment[] {
    // INSERT OR IGNORE keeps this idempotent across same-day calls (the (profileId, questDefId,
    // assignedDay) PK dedupes; a reconnect / second state read doesn't wipe progress).
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) this.stmtInsertQuest.run(profileId, id, assignedDay);
    });
    tx(questDefIds);
    return this.getActiveQuests(profileId, assignedDay);
  }

  incrementQuestProgress(profileId: string, questDefId: string, assignedDay: number, delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    // Only bumps an existing, unclaimed assignment today; a no-op for quests not assigned this
    // day (so progress never leaks across days or onto unassigned catalog entries).
    this.stmtIncQuest.run(delta, profileId, questDefId, assignedDay);
  }

  claimQuest(profileId: string, questDefId: string, assignedDay: number, goal: number): QuestAssignment | null {
    const existing = this.stmtGetOneQuest.get(profileId, questDefId, assignedDay) as QuestRow | undefined;
    if (!existing) return null;
    if (existing.claimedAt != null) return null;
    if (existing.progress < goal) return null;
    const now = Date.now();
    const info = this.stmtClaimQuest.run(now, profileId, questDefId, assignedDay, goal);
    if (info.changes === 0) return null;
    return { profileId, questDefId, assignedDay, progress: existing.progress, claimedAt: now };
  }

  getOwnedCosmetics(profileId: string): OwnedCosmetics {
    const rows = this.stmtOwnedCosmetics.all(profileId) as { unlockId: string }[];
    const profile = this.get(profileId);
    return {
      owned: rows.map((r) => r.unlockId),
      equipped: profile?.equippedCosmetics ?? {},
      softCurrency: profile?.softCurrency ?? 0,
    };
  }

  addOwnedCosmetic(profileId: string, unlockId: string): void {
    this.stmtInsertCosmetic.run(profileId, unlockId);
  }

  hasOwnedCosmetic(profileId: string, unlockId: string): boolean {
    return this.stmtHasCosmetic.get(profileId, unlockId) != null;
  }

  ping(): boolean {
    try {
      this.stmtPing.get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}

export const TRAINING_SKILL_CEILING = ABSOLUTE_SKILL_MAX;
