import type { SkillKey } from "@f1race/race-engine";

export const SKILL_META: { key: SkillKey; label: string; hint: string }[] = [
  { key: "fitness", label: "Выносливость", hint: "Стабильность к концу гонки" },
  { key: "reaction", label: "Реакция", hint: "Старт и рестарты" },
  { key: "attack", label: "Атака", hint: "Эффективность обгонов" },
  { key: "defense", label: "Защита", hint: "Удержание позиции" },
  { key: "pace", label: "Пилотирование", hint: "Чистое время круга, квала" },
  { key: "tyreMgmt", label: "Бережливость", hint: "Срок жизни резины" },
];

export function skillLabel(key: SkillKey): string {
  return SKILL_META.find((s) => s.key === key)?.label ?? key;
}
