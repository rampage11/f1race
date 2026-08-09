import type { SkillKey } from "@f1race/race-engine";

export const tyreMgmtEffectiveCap = 15;

export interface SkillMeta {
  key: SkillKey;
  label: string;
  hint: string;
  description: string;
  accent: string;
}

export const SKILL_META: SkillMeta[] = [
  {
    key: "fitness",
    label: "Выносливость",
    hint: "Стабильность к концу гонки",
    description:
      "Гасит штраф за усталость во второй половине гонки. На 10 очках усталость перестаёт мешать вовсе, выше — даёт чистую прибавку в конце заезда.",
    accent: "var(--accent-green)",
  },
  {
    key: "reaction",
    label: "Реакция",
    hint: "Старт и рестарты",
    description:
      "Расширяет окно идеального старта и снижает риск фальстарта. Основной эффект набирается к 8-9 очкам, дальше прирост почти не заметен.",
    accent: "var(--accent-blue)",
  },
  {
    key: "attack",
    label: "Атака",
    hint: "Эффективность обгонов",
    description:
      "Повышает шанс обгона — учитывается разница между вашей атакой и защитой соперника, это не абсолютное число, а перевес над конкретным противником.",
    accent: "var(--accent-red)",
  },
  {
    key: "defense",
    label: "Защита",
    hint: "Удержание позиции",
    description:
      "Снижает шанс, что вас обгонят — тот же принцип, что атака, только в обороне позиции.",
    accent: "var(--accent-purple)",
  },
  {
    key: "pace",
    label: "Пилотирование",
    hint: "Чистое время круга, квала",
    description:
      "Прямая прибавка к темпу на каждом круге, без потолка и без зависимости от этапа гонки — самый предсказуемый навык из всех.",
    accent: "var(--accent-orange)",
  },
  {
    key: "tyreMgmt",
    label: "Бережливость",
    hint: "Срок жизни резины",
    description:
      "Замедляет износ резины. Жёсткий потолок на 15 очках — выше эффекта нет вообще, тренировать дальше — потерянное время.",
    accent: "var(--accent-gold)",
  },
];

export function skillLabel(key: SkillKey): string {
  return SKILL_META.find((s) => s.key === key)?.label ?? key;
}

export function skillMeta(key: SkillKey): SkillMeta | undefined {
  return SKILL_META.find((s) => s.key === key);
}
