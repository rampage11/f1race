import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillKey } from "@f1race/race-engine";
import { ABSOLUTE_SKILL_MAX } from "@f1race/race-engine";
import type { DriverProfileSummary } from "./identity";
import { SKILL_META, skillLabel } from "./skills";
import { cancelTraining, fetchTrainingState, startTraining } from "./api";
import type { TrainingCallResult, TrainingStateDto, TrainingStateResponse } from "./api";

export interface HubScreenProps {
  profile: DriverProfileSummary;
  onRace: () => void;
  onLogout: () => void;
}

interface ActivityMeta {
  skill: SkillKey;
  icon: string;
  name: string;
}

const ACTIVITIES: ActivityMeta[] = [
  { skill: "fitness", icon: "🏋️", name: "Тренажёрный зал" },
  { skill: "pace", icon: "🏁", name: "Симулятор" },
  { skill: "reaction", icon: "⚡", name: "Реакционный тренажёр" },
  { skill: "attack", icon: "🏎️", name: "Картодром" },
  { skill: "tyreMgmt", icon: "📊", name: "Телеметрия" },
  { skill: "defense", icon: "🧠", name: "Медиа-тренинг" },
];

function activityName(skill: SkillKey): string {
  return ACTIVITIES.find((a) => a.skill === skill)?.name ?? skill;
}

function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  const base = "A".charCodeAt(0);
  const up = code.toUpperCase();
  return String.fromCodePoint(
    A + up.charCodeAt(0) - base,
    A + up.charCodeAt(1) - base,
  );
}

function fmtRemaining(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function teamColorOf(team: string): string {
  const map: Record<string, string> = {
    "Red Bull": "#1E3A8A", Ferrari: "#DC2626", Mercedes: "#00A19B", McLaren: "#F97316",
    "Aston Martin": "#15803D", Alpine: "#7C3AED", Williams: "#0EA5E9", AlphaTauri: "#475569",
    Sauber: "#16A34A", Haas: "#E5E7EB", Academy: "#FBBF24",
  };
  return map[team] ?? "#9CA3AF";
}

export function HubScreen({ profile, onRace, onLogout }: HubScreenProps) {
  const [localProfile, setLocalProfile] = useState<DriverProfileSummary>(profile);
  const [training, setTraining] = useState<TrainingStateDto>({ status: "idle" });
  const [activeEndsAt, setActiveEndsAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<boolean>(false);
  activeRef.current = training.status === "active";

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const applyResponse = useCallback(
    (resp: TrainingStateResponse) => {
      setTraining(resp.training);
      setActiveEndsAt(
        resp.training.status === "active" ? Date.now() + resp.training.remainingSec * 1000 : 0,
      );
      setLocalProfile(resp.profile);
      if (resp.justCompleted) {
        showToast(`+1 ${skillLabel(resp.justCompleted.skill)}`);
      }
    },
    [showToast],
  );

  const refresh = useCallback(async () => {
    const r = await fetchTrainingState();
    if (r) applyResponse(r);
  }, [applyResponse]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await fetchTrainingState();
      if (cancelled || !r) return;
      applyResponse(r);
    };
    load();
    const id = setInterval(() => {
      if (activeRef.current) load();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [applyResponse]);

  useEffect(() => {
    if (training.status !== "active") return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (activeEndsAt > 0 && Date.now() >= activeEndsAt) {
        refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [training.status, activeEndsAt, refresh]);

  const handleStart = useCallback(
    async (skill: SkillKey) => {
      setBusy(true);
      setError(null);
      const r: TrainingCallResult = await startTraining(skill);
      setBusy(false);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      applyResponse(r);
    },
    [applyResponse],
  );

  const handleCancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r: TrainingCallResult = await cancelTraining();
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    applyResponse(r);
  }, [applyResponse]);

  const activeSkill = training.status === "active" ? training.skill : null;
  const remaining = activeEndsAt > 0 ? Math.max(0, Math.round((activeEndsAt - now) / 1000)) : 0;
  const hero = localProfile.hero;

  return (
    <div className="hub">
      {toast && <div className="hub-toast">{toast}</div>}

      <div className="hub-pilot-card">
        <div className="hub-pilot-head">
          <div className="hub-pilot-name">
            <span className="hub-flag">{flagEmoji(hero.country)}</span>
            <strong>{hero.name}</strong>
            <span className="team-dot-inline" style={{ background: teamColorOf(hero.team) }} />
            <span className="hub-team">{hero.team}</span>
          </div>
          <button className="auth-logout" onClick={onLogout}>Выйти</button>
        </div>
        <div className="hub-pilot-meta">
          <span className="hub-div-line">{localProfile.division} · рейтинг {localProfile.driverRating}</span>
          <span className="hub-level">Уровень {localProfile.level}</span>
          <span className="hub-muted">Гонок: {localProfile.racesCount} · {localProfile.totalXp} XP</span>
        </div>
      </div>

      <div className="hub-skills">
        <h2 className="hub-section-title">Навыки пилота</h2>
        <div className="hub-skill-list">
          {SKILL_META.map((s) => {
            const value = hero.skills[s.key];
            const pct = Math.min(100, (value / ABSOLUTE_SKILL_MAX) * 100);
            return (
              <div className="skill-bar" key={s.key}>
                <div className="skill-bar-head">
                  <span className="skill-bar-name">{s.label}</span>
                  <span className="skill-bar-value">{value}<span className="skill-bar-max">/{ABSOLUTE_SKILL_MAX}</span></span>
                </div>
                <div className="skill-bar-track">
                  <div className="skill-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hub-activities">
        <h2 className="hub-section-title">Тренировки</h2>
        {activeSkill && (
          <p className="hub-active-hint">Идёт тренировка: {activityName(activeSkill)}</p>
        )}
        <div className="activity-grid">
          {ACTIVITIES.map((a) => {
            const isActive = activeSkill === a.skill;
            const maxed = hero.skills[a.skill] >= ABSOLUTE_SKILL_MAX;
            const disabled = busy || (!!activeSkill && !isActive) || (maxed && !isActive);
            return (
              <div className={`activity-card ${isActive ? "active" : ""}`} key={a.skill}>
                <div className="activity-card-head">
                  <span className="activity-icon" aria-hidden="true">{a.icon}</span>
                  <div className="activity-card-titles">
                    <span className="activity-name">{a.name}</span>
                    <span className="activity-target">→ {skillLabel(a.skill)}</span>
                  </div>
                </div>
                {isActive ? (
                  <div className="activity-running">
                    <span className="activity-countdown">{fmtRemaining(remaining)}</span>
                    <button className="activity-cancel" disabled={busy} onClick={handleCancel}>Отменить</button>
                  </div>
                ) : maxed ? (
                  <div className="activity-maxed">Максимум</div>
                ) : (
                  <button
                    className="activity-train"
                    disabled={disabled}
                    onClick={() => handleStart(a.skill)}
                  >
                    Тренировать
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {error && <p className="warn-text hub-error">{error}</p>}
      </div>

      <button className="race-cta" onClick={onRace}>🏁 Гонка</button>
    </div>
  );
}
