import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverProfileSummary } from "./identity";
import { claimQuest, fetchQuestsState } from "./api";
import type { QuestView } from "./api";
import styles from "./LeaderboardScreen.module.css";

export interface QuestsPanelProps {
  onProfileChanged: (profile: DriverProfileSummary) => void;
  onClose: () => void;
}

export function QuestsPanel({ onProfileChanged, onClose }: QuestsPanelProps) {
  const [quests, setQuests] = useState<QuestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refresh = useCallback(async () => {
    const r = await fetchQuestsState();
    if (r && "quests" in r) {
      setQuests(r.quests);
      onProfileChanged(r.profile);
    }
    setLoading(false);
  }, [onProfileChanged]);

  useEffect(() => {
    refresh();
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [refresh]);

  const handleClaim = async (q: QuestView) => {
    if (busyId) return;
    setBusyId(q.questDefId);
    setError(null);
    const r = await claimQuest(q.questDefId);
    setBusyId(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setQuests(r.quests);
    onProfileChanged(r.profile);
    showToast(`+${r.claimed.xp} XP, +${r.claimed.currency} CR`);
  };

  const claimableCount = quests.filter((q) => !q.claimed && q.progress >= q.goal).length;

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Ежедневные задания">
      <div className={`glass-panel ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Закрыть">×</button>

        <header className={styles.header}>
          <h2 className="ds-heading">Задания дня</h2>
          <p className={styles.note} style={{ margin: 0, textAlign: "left" }}>
            Новые задания каждый день
            {claimableCount > 0 ? ` · готово получить: ${claimableCount}` : ""}
          </p>
        </header>

        {toast && (
          <div className={styles.meBanner} style={{ background: "rgba(0, 210, 106, 0.12)", borderColor: "rgba(0, 210, 106, 0.4)", color: "var(--accent-green)" }}>
            {toast}
          </div>
        )}
        {error && (
          <div className={styles.meBanner} style={{ background: "rgba(255, 45, 85, 0.10)", borderColor: "rgba(255, 45, 85, 0.4)", color: "var(--accent-red)" }}>
            {error}
          </div>
        )}

        <div className={styles.list}>
          {loading ? (
            <p className={styles.empty}>Загрузка…</p>
          ) : quests.length === 0 ? (
            <p className={styles.empty}>Заданий пока нет.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {quests.map((q) => {
                const complete = q.progress >= q.goal;
                const canClaim = complete && !q.claimed;
                const pct = q.goal > 0 ? Math.min(100, (q.progress / q.goal) * 100) : 0;
                return (
                  <div
                    key={q.questDefId}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "12px 14px",
                      background: "var(--bg-elevated)",
                      border: `1px solid ${q.claimed ? "var(--border-subtle)" : canClaim ? "var(--accent-green)" : "var(--border-subtle)"}`,
                      borderRadius: 10,
                      opacity: q.claimed ? 0.55 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>{q.desc}</span>
                      {q.claimed && <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>получено ✓</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--bg-surface)", borderRadius: 4, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: canClaim ? "var(--accent-green)" : q.claimed ? "var(--text-tertiary)" : "var(--accent-gold)",
                          }}
                        />
                      </div>
                      <span className="ds-mono" style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 56, textAlign: "right" }}>
                        {Math.min(q.progress, q.goal)}/{q.goal}
                      </span>
                      <button
                        onClick={() => handleClaim(q)}
                        disabled={!canClaim || busyId !== null}
                        style={{
                          padding: "5px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                          fontFamily: "var(--font-display)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: canClaim ? "#04161a" : "var(--text-tertiary)",
                          background: canClaim ? "var(--accent-green)" : "var(--bg-surface)",
                          border: `1px solid ${canClaim ? "var(--accent-green)" : "var(--border-subtle)"}`,
                          borderRadius: 6,
                          cursor: canClaim ? "pointer" : "not-allowed",
                        }}
                      >
                        {busyId === q.questDefId ? "…" : q.claimed ? "✓" : "Забрать"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className={styles.note}>Новые задания каждый день · выполняются в гонках и тренировках</p>
      </div>
    </div>
  );
}
