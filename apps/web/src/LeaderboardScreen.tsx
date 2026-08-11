import { useEffect, useState } from "react";
import type { Division, DriverProfileSummary } from "./identity";
import { fetchLeaderboard, type LeaderboardResult, type LeaderboardSeason } from "./api";
import styles from "./LeaderboardScreen.module.css";

export interface LeaderboardScreenProps {
  profile: DriverProfileSummary;
  onClose: () => void;
}

const TABS: Division[] = ["F1", "F2", "F3", "F4"];
type Scope = "allTime" | "season";

function formatReset(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  if (d > 0) return `до конца сезона: ${d}д ${h}ч`;
  const m = Math.floor((totalSec % 3600) / 60);
  return `до конца сезона: ${h}ч ${m}м`;
}

export function LeaderboardScreen({ profile, onClose }: LeaderboardScreenProps) {
  const [division, setDivision] = useState<Division>(profile.division);
  const [scope, setScope] = useState<Scope>("allTime");
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetLabel, setResetLabel] = useState<string | null>(null);

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
    const seasonArg = scope === "season" ? "current" : undefined;
    fetchLeaderboard(division, 50, seasonArg).then((res) => {
      if (cancelled) return;
      setData(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [division, scope]);

  // Ticking countdown for the season reset instant.
  useEffect(() => {
    if (scope !== "season") {
      setResetLabel(null);
      return;
    }
    const season: LeaderboardSeason | undefined = data?.season;
    if (!season) {
      setResetLabel(null);
      return;
    }
    const tick = () => setResetLabel(formatReset(season.resetAt - Date.now()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [scope, data?.season]);

  const me = data?.me;
  const seasonal = scope === "season" && !!data?.season;

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
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${scope === "allTime" ? styles.tabActive : ""}`}
              onClick={() => setScope("allTime")}
            >
              Всё время
            </button>
            <button
              className={`${styles.tab} ${scope === "season" ? styles.tabActive : ""}`}
              onClick={() => setScope("season")}
            >
              Сезон
            </button>
          </div>
          {seasonal && data?.season && (
            <div className={styles.meBanner} style={{ background: "rgba(0, 210, 106, 0.08)", borderColor: "rgba(0, 210, 106, 0.3)", color: "var(--accent-green)" }}>
              <span>Сезон {data.season.label}</span>
              <span className={`ds-mono ${styles.meRating}`}>{resetLabel ?? ""}</span>
            </div>
          )}
        </header>

        {me && (
          <div className={styles.meBanner}>
            <span className={`ds-mono ${styles.meRank}`}>#{me.rank}</span>
            <span>Вы в дивизионе {division}</span>
            <span className={`ds-mono ${styles.meRating}`}>
              {seasonal && typeof me.xpGained === "number" ? `${me.xpGained} XP за неделю` : `${me.driverRating} рейтинга`}
            </span>
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
                  <th className="ds-microtext">{seasonal ? "XP/нед" : "Рейтинг"}</th>
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
                      <td className="ds-mono">
                        {seasonal ? (typeof r.xpGained === "number" ? r.xpGained : 0) : r.driverRating}
                      </td>
                      <td className="ds-mono">{r.racesCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className={styles.note}>
          {seasonal
            ? `Топ-50 дивизиона за неделю (SUM XP с понедельника). ${resetLabel ?? ""}`
            : "Топ-50 дивизиона по driverRating. Обновляется после каждой гонки."}
        </p>
      </div>
    </div>
  );
}
