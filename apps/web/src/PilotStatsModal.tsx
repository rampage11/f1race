import { useEffect } from "react";
import { ABSOLUTE_SKILL_MAX } from "@f1race/race-engine";
import type { Division, DriverProfileSummary } from "./identity";
import { SKILL_META, tyreMgmtEffectiveCap } from "./skills";
import styles from "./PilotStatsModal.module.css";

export interface PilotStatsModalProps {
  profile: DriverProfileSummary;
  onClose: () => void;
}

const DIVISION_THRESHOLDS: { div: Division; range: string }[] = [
  { div: "F1", range: "35+" },
  { div: "F2", range: "20–34" },
  { div: "F3", range: "10–19" },
  { div: "F4", range: "<10" },
];

function skillSum(p: DriverProfileSummary): number {
  const s = p.hero.skills;
  return s.fitness + s.reaction + s.attack + s.defense + s.pace + s.tyreMgmt;
}

export function PilotStatsModal({ profile, onClose }: PilotStatsModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hero = profile.hero;
  const ss = skillSum(profile);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Статы пилота">
      <div className={`glass-panel ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Закрыть">×</button>

        <header className={styles.header}>
          <h2 className={`ds-heading ${styles.name}`}>{hero.name}</h2>
          <div className={styles.team}>{hero.team}</div>
          <div className={styles.badges}>
            <span className={styles.divBadge}>{profile.division}</span>
            <span className={styles.metric}>
              <span className="ds-microtext">Уровень</span> <strong className="ds-mono">{profile.level}</strong>
            </span>
            <span className={styles.metric}>
              <span className="ds-microtext">Рейтинг</span> <strong className="ds-mono">{profile.driverRating}</strong>
            </span>
          </div>
        </header>

        <section className={styles.section}>
          <h3 className={`ds-heading ${styles.sectionTitle}`}>Навыки</h3>
          <div className={styles.skills}>
            {SKILL_META.map((s) => {
              const value = hero.skills[s.key];
              const maxed = value >= ABSOLUTE_SKILL_MAX;
              const capped =
                s.key === "tyreMgmt" && value >= tyreMgmtEffectiveCap && value < ABSOLUTE_SKILL_MAX;
              const pct = (value / ABSOLUTE_SKILL_MAX) * 100;
              return (
                <div className={styles.skill} key={s.key}>
                  <div className={styles.skillHead}>
                    <span className={styles.skillName} style={{ color: s.accent }}>
                      {s.label}
                    </span>
                    <span className={`ds-mono ${styles.skillValue}`}>
                      {value}
                      <span className={styles.skillMax}>/{ABSOLUTE_SKILL_MAX}</span>
                    </span>
                  </div>
                  <div className={styles.skillTrack}>
                    <div className={styles.skillFill} style={{ width: `${pct}%`, background: s.accent }} />
                  </div>
                  <p className={styles.skillDesc}>{s.description}</p>
                  {capped && (
                    <div className={styles.capWarn}>Эффективный потолок на 15 — дальше без эффекта</div>
                  )}
                  {maxed && <div className={styles.maxed}>Максимум</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={`ds-heading ${styles.sectionTitle}`}>Уровень и рейтинг</h3>
          <div className={styles.nums}>
            <div className={styles.numCell}>
              <span className="ds-microtext">Уровень</span>
              <strong className="ds-mono">{profile.level}</strong>
            </div>
            <div className={styles.numCell}>
              <span className="ds-microtext">Сумма навыков</span>
              <strong className="ds-mono">{ss}</strong>
            </div>
            <div className={styles.numCell}>
              <span className="ds-microtext">Рейтинг</span>
              <strong className="ds-mono">{profile.driverRating}</strong>
            </div>
          </div>
          <p className={styles.explain}>
            Уровень растёт от участия в гонках. Рейтинг = уровень + бонус от навыков сверх стартовых 10 очков —
            именно рейтинг определяет дивизион, поэтому одна прокачка без гонок или одни гонки без прокачки не
            дадут перепрыгнуть в следующий дивизион.
          </p>
          <p className={styles.explainNote}>Каждый уровень немного снижает время тренировки (до −20%).</p>
          <div className={styles.divisions}>
            <span className="ds-microtext">Пороги дивизионов (по рейтингу):</span>
            <div className={styles.divTable}>
              {DIVISION_THRESHOLDS.map((d) => (
                <div
                  key={d.div}
                  className={`${styles.divRow} ${d.div === profile.division ? styles.divCurrent : ""}`}
                >
                  <span className={styles.divName}>{d.div}</span>
                  <span className={`ds-mono ${styles.divRange}`}>{d.range}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <button className={styles.trainBtn} onClick={onClose}>
          К тренировкам
        </button>
      </div>
    </div>
  );
}
