import { useEffect, useState } from "react";
import type { Division, DriverProfileSummary } from "./identity";
import { fetchLeaderboard, type LeaderboardResult } from "./api";
import styles from "./LeaderboardScreen.module.css";

export interface LeaderboardScreenProps {
  profile: DriverProfileSummary;
  onClose: () => void;
}

const TABS: Division[] = ["F1", "F2", "F3", "F4"];

export function LeaderboardScreen({ profile, onClose }: LeaderboardScreenProps) {
  const [division, setDivision] = useState<Division>(profile.division);
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLeaderboard(division, 50).then((res) => {
      if (cancelled) return;
      setData(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [division]);

  const me = data?.me;

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Таблица лидеров">
      <div className={`glass-panel ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Закрыть">×</button>

        <header className={styles.header}>
          <h2 className="ds-heading">Таблица лидеров</h2>
          <div className={styles.tabs}>
            {TABS.map((d) => (
              <button
                key={d}
                className={`${styles.tab} ${d === division ? styles.tabActive : ""}`}
                onClick={() => setDivision(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </header>

        {me && (
          <div className={styles.meBanner}>
            <span className={`ds-mono ${styles.meRank}`}>#{me.rank}</span>
            <span>Вы в дивизионе {division}</span>
            <span className={`ds-mono ${styles.meRating}`}>{me.driverRating} рейтинга</span>
          </div>
        )}

        <div className={styles.list}>
          {loading ? (
            <p className={styles.empty}>Загрузка…</p>
          ) : !data || data.rows.length === 0 ? (
            <p className={styles.empty}>Пока пусто — станьте первым в этом дивизионе.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className="ds-microtext">#</th>
                  <th className="ds-microtext">Пилот</th>
                  <th className="ds-microtext">Команда</th>
                  <th className="ds-microtext">Рейтинг</th>
                  <th className="ds-microtext">Гонки</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const isMe = r.guestId === profile.guestId;
                  return (
                    <tr key={r.guestId} className={isMe ? styles.rowMe : undefined}>
                      <td className={`ds-mono ${styles.rankCell}`}>{r.rank}</td>
                      <td className={styles.nameCell}>{r.name}</td>
                      <td className={styles.teamCell}>{r.team}</td>
                      <td className="ds-mono">{r.driverRating}</td>
                      <td className="ds-mono">{r.racesCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className={styles.note}>Топ-50 дивизиона по driverRating. Обновляется после каждой гонки.</p>
      </div>
    </div>
  );
}
