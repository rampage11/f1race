import { useEffect, useState } from "react";
import { ABSOLUTE_SKILL_MAX, type SkillKey, type Skills } from "@f1race/race-engine";
import type { Division, DriverProfileSummary } from "./identity";
import { respecSkills } from "./api";
import { SKILL_META, tyreMgmtEffectiveCap } from "./skills";
import styles from "./PilotStatsModal.module.css";

export interface PilotStatsModalProps {
  profile: DriverProfileSummary;
  onClose: () => void;
  onProfileChanged?: (p: DriverProfileSummary) => void;
}

const DIVISION_THRESHOLDS: { div: Division; range: string }[] = [
  { div: "F1", range: "35+" },
  { div: "F2", range: "20–34" },
  { div: "F3", range: "10–19" },
  { div: "F4", range: "<10" },
];

function skillSum(s: Skills): number {
  return s.fitness + s.reaction + s.attack + s.defense + s.pace + s.tyreMgmt;
}

export function PilotStatsModal({ profile: initial, onClose, onProfileChanged }: PilotStatsModalProps) {
  const [hero, setHero] = useState(initial.hero);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Skills>(initial.hero.skills);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const originalSum = skillSum(initial.hero.skills);
  const draftSum = skillSum(draft);
  const remaining = originalSum - draftSum;
  const canSubmit = remaining === 0 && !busy;

  const beginRespec = (): void => {
    setDraft(hero.skills);
    setError(null);
    setEditing(true);
  };

  const adjust = (key: SkillKey, delta: number): void => {
    setDraft((d) => {
      const cap = key === "tyreMgmt" ? tyreMgmtEffectiveCap : ABSOLUTE_SKILL_MAX;
      const next = Math.max(0, Math.min(cap, d[key] + delta));
      if (next === d[key]) return d;
      const trial: Skills = { ...d, [key]: next };
      if (skillSum(trial) > originalSum) return d;
      return trial;
    });
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const res = await respecSkills(draft);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setHero(res.profile.hero);
    onProfileChanged?.(res.profile);
    setEditing(false);
  };

  const ss = skillSum(hero.skills);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Статы пилота">
      <div className={`glass-panel ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Закрыть">×</button>

        <header className={styles.header}>
          <h2 className={`ds-heading ${styles.name}`}>{hero.name}</h2>
          <div className={styles.team}>{hero.team}</div>
          <div className={styles.badges}>
            <span className={styles.divBadge}>{initial.division}</span>
            <span className={styles.metric}>
              <span className="ds-microtext">Уровень</span> <strong className="ds-mono">{initial.level}</strong>
            </span>
            <span className={styles.metric}>
              <span className="ds-microtext">Рейтинг</span> <strong className="ds-mono">{initial.driverRating}</strong>
            </span>
          </div>
        </header>

        <section className={styles.section}>
          <h3 className={`ds-heading ${styles.sectionTitle}`}>
            Навыки
            {editing && (
              <span className={styles.respecCounter}>
                очков в запасе: <strong className={remaining === 0 ? "ok" : ""}>{remaining}</strong>
              </span>
            )}
          </h3>
          <div className={styles.skills}>
            {SKILL_META.map((s) => {
              const value = editing ? draft[s.key] : hero.skills[s.key];
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
                  {editing ? (
                    <div className={styles.editCtrl}>
                      <button className={styles.editBtn} onClick={() => adjust(s.key, -1)} disabled={value <= 0}>−</button>
                      <div className={styles.editTrack}>
                        <div className={styles.skillFill} style={{ width: `${pct}%`, background: s.accent }} />
                      </div>
                      <button
                        className={styles.editBtn}
                        onClick={() => adjust(s.key, 1)}
                        disabled={value >= (s.key === "tyreMgmt" ? tyreMgmtEffectiveCap : ABSOLUTE_SKILL_MAX) || remaining <= 0}
                      >+</button>
                    </div>
                  ) : (
                    <div className={styles.skillTrack}>
                      <div className={styles.skillFill} style={{ width: `${pct}%`, background: s.accent }} />
                    </div>
                  )}
                  <p className={styles.skillDesc}>{s.description}</p>
                  {capped && (
                    <div className={styles.capWarn}>Эффективный потолок на 15 — дальше без эффекта</div>
                  )}
                  {maxed && <div className={styles.maxed}>Максимум</div>}
                </div>
              );
            })}
          </div>

          {editing ? (
            <div className={styles.respecActions}>
              {error && <p className={styles.respecError}>{error}</p>}
              <button
                className={`neon-button ${styles.respecSubmit}`}
                onClick={submit}
                disabled={!canSubmit}
              >
                {busy ? "Сохранение…" : "Применить"}
              </button>
              <button className={styles.respecCancel} onClick={() => { setEditing(false); setError(null); }} disabled={busy}>
                Отмена
              </button>
            </div>
          ) : (
            <button className={styles.respecBtn} onClick={beginRespec}>
              Перераспределить навыки
            </button>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={`ds-heading ${styles.sectionTitle}`}>Уровень и рейтинг</h3>
          <div className={styles.nums}>
            <div className={styles.numCell}>
              <span className="ds-microtext">Уровень</span>
              <strong className="ds-mono">{initial.level}</strong>
            </div>
            <div className={styles.numCell}>
              <span className="ds-microtext">Сумма навыков</span>
              <strong className="ds-mono">{ss}</strong>
            </div>
            <div className={styles.numCell}>
              <span className="ds-microtext">Рейтинг</span>
              <strong className="ds-mono">{initial.driverRating}</strong>
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
                  className={`${styles.divRow} ${d.div === initial.division ? styles.divCurrent : ""}`}
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
