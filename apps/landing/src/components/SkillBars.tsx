import { useRef } from "react";
import { Section } from "./Section";
import { useInView } from "../lib/useInView";
import { useReducedMotion } from "../lib/useReducedMotion";
import styles from "./SkillBars.module.css";

interface Skill {
  key: string;
  label: string;
  hint: string;
  value: number;
}

const SKILL_MAX = 20;

const SKILLS: Skill[] = [
  { key: "fitness", label: "Выносливость", hint: "Стабильность к концу гонки", value: 14 },
  { key: "reaction", label: "Реакция", hint: "Старт и рестарты", value: 14 },
  { key: "attack", label: "Атака", hint: "Эффективность обгонов", value: 11 },
  { key: "defense", label: "Защита", hint: "Удержание позиции", value: 12 },
  { key: "pace", label: "Пилотирование", hint: "Чистое время круга, квала", value: 15 },
  { key: "tyreMgmt", label: "Бережливость", hint: "Срок жизни резины", value: 10 },
];

export function SkillBars() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, 0.2);
  const reduced = useReducedMotion();
  const shown = reduced || inView;

  return (
    <Section id="progression" index="03" label="SECTOR 3 — Прогрессия" title="Твой пилот растёт по-настоящему" bg="/img/sector-progression.webp">
      <div ref={ref} className={styles.grid}>
        {SKILLS.map((s) => {
          const pct = Math.round((s.value / SKILL_MAX) * 100);
          return (
            <div key={s.key} className={styles.skill}>
              <div className={styles.skillHead}>
                <span className={styles.skillLabel}>{s.label}</span>
                <span className={`mono ${styles.skillVal}`}>
                  {s.value}
                  <span className={styles.skillMax}> / {SKILL_MAX}</span>
                </span>
              </div>
              <div className={styles.bar}>
                <div className={styles.fill} style={{ width: shown ? `${pct}%` : "0%" }} />
              </div>
              <div className={styles.hint}>{s.hint}</div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
