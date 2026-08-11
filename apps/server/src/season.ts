const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// 1970-01-01 was a Thursday. To make weeks Monday-start we offset the day number so
// Monday collapses to the first column ((day + 7 - THU) % 7 == 0 for a Monday).
const EPOCH_WEEKDAY_THU = 4;

export interface SeasonWeek {
  weekStart: number;
  // Inclusive end (the last ms of the week). A race whose finishedAt <= weekEnd counts.
  weekEnd: number;
  label: string;
}

function mondayDay(day: number): number {
  const dow = ((day + 7 - EPOCH_WEEKDAY_THU) % 7 + 7) % 7;
  return day - dow;
}

// ISO 8601 week-of-year for the week whose Monday is `mondayMs`. Computed off the year's
// first Thursday (always in ISO week 1) so year rollover near Jan is correct.
function isoWeekLabel(mondayMs: number): string {
  const thursdayMs = mondayMs + 3 * MS_PER_DAY;
  const year = new Date(thursdayMs).getUTCFullYear();
  const firstThursdayDay = Math.floor(Date.UTC(year, 0, 4) / MS_PER_DAY);
  const week1MondayDay = mondayDay(firstThursdayDay);
  const week = Math.floor((mondayMs / MS_PER_DAY - week1MondayDay) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Monday-start UTC week containing `ts`. Seasons are weekly; the leaderboard `?season=current`
// scopes `race_history` rows to [weekStart, weekEnd].
export function seasonWeek(ts: number): SeasonWeek {
  const day = Math.floor(ts / MS_PER_DAY);
  const monDay = mondayDay(day);
  const weekStart = monDay * MS_PER_DAY;
  const weekEnd = weekStart + MS_PER_WEEK - 1;
  return { weekStart, weekEnd, label: isoWeekLabel(weekStart) };
}

export function currentSeasonWeek(now: number = Date.now()): SeasonWeek {
  return seasonWeek(now);
}

// Ms from `now` until the current week's `weekEnd` (the reset instant for the UI countdown).
export function msUntilWeekReset(now: number = Date.now()): number {
  const w = seasonWeek(now);
  return Math.max(0, w.weekEnd - now + 1);
}
