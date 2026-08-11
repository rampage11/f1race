import { mulberry32 } from "@f1race/race-engine";

export interface QuestDef {
  id: string;
  desc: string;
  goal: number;
  xp: number;
  currency: number;
}

// Static pool of daily-quest definitions. Three are assigned per UTC day, deterministically
// seeded by (profileId, day) so a player's three quests are stable across reconnects that day.
// All goals are integer-reachable within a single race/day of activity.
export const QUEST_DEFS: readonly QuestDef[] = [
  { id: "finish_race", desc: "Финишируйте гонку", goal: 1, xp: 30, currency: 15 },
  { id: "finish_top5", desc: "Финишируй в топ-5", goal: 1, xp: 60, currency: 25 },
  { id: "overtakes_2", desc: "Сделай 2 обгона за гонку", goal: 2, xp: 50, currency: 20 },
  { id: "start_training", desc: "Запустите тренировку", goal: 1, xp: 40, currency: 15 },
  { id: "pit_stop", desc: "Сделайте пит-стоп", goal: 1, xp: 30, currency: 15 },
  { id: "fastest_lap", desc: "Покажите быстрейший круг", goal: 1, xp: 70, currency: 30 },
];

export const QUESTS_PER_DAY = 3;

const QUEST_BY_ID: ReadonlyMap<string, QuestDef> = new Map(QUEST_DEFS.map((q) => [q.id, q]));

export function questById(id: string): QuestDef | null {
  return QUEST_BY_ID.get(id) ?? null;
}

// FNV-1a hash of (profileId, day) → a 32-bit seed for mulberry32. Same (profileId, day) always
// picks the same three quests; a different player or a new day re-rolls.
function hashSeed(profileId: string, day: number): number {
  let h = 0x811c9dc5;
  const s = `${profileId}:${day}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministically pick `QUESTS_PER_DAY` distinct quest ids for the given (profileId, day).
export function pickDailyQuestIds(profileId: string, day: number): string[] {
  const rng = mulberry32(hashSeed(profileId, day));
  const pool = [...QUEST_DEFS];
  const picked: string[] = [];
  while (picked.length < QUESTS_PER_DAY && pool.length > 0) {
    const idx = Math.floor(rng.next() * pool.length) % pool.length;
    picked.push(pool.splice(idx, 1)[0]!.id);
  }
  return picked;
}
