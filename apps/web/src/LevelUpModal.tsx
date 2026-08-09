import { useEffect, useState } from "react";
import { ABSOLUTE_SKILL_MAX, type SkillKey } from "@f1race/race-engine";
import type { DriverProfileSummary } from "./identity";
import { allocateSkillPoint } from "./api";
import { SKILL_META, tyreMgmtEffectiveCap } from "./skills";
import styles from "./PilotStatsModal.module.css";

export interface LevelUpModalProps {
  profile: DriverProfileSummary;
  onAllocated: (profile: DriverProfileSummary) => void;
  onClose: () => void;
}

export function LevelUpModal({ profile: initial, onAllocated, onClose }: LevelUpModalProps) {
  const [skills, setSkills] = useState(initial.hero.skills);
  const [remaining, setRemaining] = useState(initial.unspentSkillPoints);
  const [busy, setBusy] = useState<SkillKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && remaining === 0) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [remaining, onClose]);

  const allocate = async (key: SkillKey): Promise<void> => {
    if (busy || remaining <= 0) return;
    setBusy(key);
    setError(null);
    const res = await allocateSkillPoint(key);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSkills(res.profile.hero.skills);
    setRemaining(res.profile.unspentSkillPoints);
    onAllocated(res.profile);
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Новый уровень">
      <div className={`glass-panel ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={`ds-heading ${styles.name}`}>Новый уровень!</h2>
          <div className={styles.team}>
            {remaining > 0
              ? `Распределите очко навыка (${remaining} в запасе)`
              : "Все очки распределены"}
          </div>
        </header>

        <section className={styles.section}>
          <div className={styles.skills}>
            {SKILL_META.map((s) => {
              const value = skills[s.key];
              const cap = s.key === "tyreMgmt" ? tyreMgmtEffectiveCap : ABSOLUTE_SKILL_MAX;
              const maxed = value >= cap;
              const pct = (value / ABSOLUTE_SKILL_MAX) * 100;
              return (
                <div className={styles.skill} key={s.key}>
                  <div className={styles.skillHead}>
                    <span className={styles.skillName} style={{ color: s.accent }}>{s.label}</span>
                    <span className={`ds-mono ${styles.skillValue}`}>{value}</span>
                  </div>
                  <div className={styles.editCtrl}>
                    <div className={styles.editTrack}>
                      <div className={styles.skillFill} style={{ width: `${pct}%`, background: s.accent }} />
                    </div>
                    <button
                      className={styles.editBtn}
                      onClick={() => allocate(s.key)}
                      disabled={maxed || remaining <= 0 || busy !== null}
                      aria-label={`+1 ${s.label}`}
                    >+</button>
                  </div>
                  <p className={styles.skillDesc}>{s.hint}</p>
                </div>
              );
            })}
          </div>
          {error && <p className={styles.respecError}>{error}</p>}
        </section>

        <button
          className={styles.trainBtn}
          onClick={onClose}
          disabled={remaining > 0}
          title={remaining > 0 ? "Сначала распределите все очки" : undefined}
        >
          {remaining > 0 ? `Осталось очков: ${remaining}` : "Готово"}
        </button>
      </div>
    </div>
  );
}
