import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillKey } from "@f1race/race-engine";
import { ABSOLUTE_SKILL_MAX } from "@f1race/race-engine";
import type { DriverProfileSummary } from "./identity";
import { skillLabel, skillMeta, tyreMgmtEffectiveCap } from "./skills";
import { cancelTraining, fetchTrainingState, startTraining } from "./api";
import type { TrainingCallResult, TrainingStateDto, TrainingStateResponse } from "./api";
import { PilotStatsModal } from "./PilotStatsModal";
import styles from "./HubScreen.module.css";

export interface HubScreenProps {
  profile: DriverProfileSummary;
  onRace: () => void;
  onLogout: () => void;
}

interface BuildingDef {
  id: "race" | SkillKey;
  role: "race" | "training";
  skill?: SkillKey;
  name: string;
  img: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const BASE = import.meta.env.BASE_URL;
const asset = (p: string): string => `${BASE}${p}`;

const BUILDINGS: BuildingDef[] = [
  { id: "fitness", role: "training", skill: "fitness", name: "Тренажёрный зал", img: asset("img/hub/building-fitness.png"), x: 4, y: 13, w: 21, h: 17 },
  { id: "pace", role: "training", skill: "pace", name: "Симулятор", img: asset("img/hub/building-pace.png"), x: 39, y: 11, w: 22, h: 17 },
  { id: "reaction", role: "training", skill: "reaction", name: "Реакция", img: asset("img/hub/building-reaction.png"), x: 74, y: 13, w: 22, h: 17 },
  { id: "attack", role: "training", skill: "attack", name: "Картодром", img: asset("img/hub/building-attack.png"), x: 3, y: 32, w: 22, h: 17 },
  { id: "tyreMgmt", role: "training", skill: "tyreMgmt", name: "Телеметрия", img: asset("img/hub/building-tyreMgmt.png"), x: 39, y: 31, w: 22, h: 17 },
  { id: "defense", role: "training", skill: "defense", name: "Медиа-центр", img: asset("img/hub/building-defense.png"), x: 75, y: 32, w: 22, h: 17 },
  { id: "race", role: "race", name: "Гонка", img: asset("img/hub/building-race.png"), x: 27, y: 51, w: 46, h: 31 },
];

function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  const base = "A".charCodeAt(0);
  const up = code.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - base, A + up.charCodeAt(1) - base);
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

function skillHint(key: SkillKey): string {
  return skillMeta(key)?.hint ?? "";
}

export function HubScreen({ profile, onRace, onLogout }: HubScreenProps) {
  const [localProfile, setLocalProfile] = useState<DriverProfileSummary>(profile);
  const [training, setTraining] = useState<TrainingStateDto>({ status: "idle" });
  const [activeEndsAt, setActiveEndsAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showStats, setShowStats] = useState<boolean>(false);
  const [showMetaTip, setShowMetaTip] = useState<boolean>(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!showMetaTip) return;
    const onDocClick = (e: MouseEvent) => {
      if (tipRef.current && !tipRef.current.contains(e.target as Node)) {
        setShowMetaTip(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMetaTip(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [showMetaTip]);

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
  const skillValue = (k: SkillKey) => hero.skills[k];

  return (
    <div className={styles.root}>
      {toast && <div className={styles.toast}>{toast}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.map}>
        <img className={styles.bg} src={asset("img/hub/hub-bg.png")} alt="" draggable={false} />

        <div className={styles.hud}>
          <div className={styles.hudLeft}>
            <span className={styles.flag}>{flagEmoji(hero.country)}</span>
            <button
              type="button"
              className={styles.hudId}
              onClick={() => setShowStats(true)}
              aria-label="Открыть статы пилота"
            >
              <strong className={styles.hudName}>{hero.name}</strong>
              <span className={styles.hudMeta}>
                <span className={styles.teamDot} style={{ background: teamColorOf(hero.team) }} />
                {hero.team}
              </span>
              <span className={styles.statsHint}>статы →</span>
            </button>
          </div>
          <div className={styles.hudRight}>
            <span className={styles.hudStat}>{localProfile.division} · {localProfile.driverRating}</span>
            <span className={styles.hudStat}>Ур. {localProfile.level}</span>
            <button
              ref={tipRef}
              type="button"
              className={styles.infoBtn}
              onClick={() => setShowMetaTip((v) => !v)}
              aria-label="Что значат уровень и рейтинг"
              aria-expanded={showMetaTip}
            >
              i
              {showMetaTip && (
                <span className={styles.infoTip} role="tooltip">
                  Уровень — ваша гоночная история (растёт от гонок). Рейтинг = уровень + бонус от навыков, именно он определяет дивизион. Уровень также снижает время тренировки до −20%.
                </span>
              )}
            </button>
            <button className={styles.logout} onClick={onLogout}>Выйти</button>
          </div>
        </div>

        {BUILDINGS.map((b) => {
          const isTraining = b.role === "training";
          const sk = b.skill;
          const isActive = isTraining && sk != null && activeSkill === sk;
          const value = sk != null ? skillValue(sk) : 0;
          const maxed = isTraining && value >= ABSOLUTE_SKILL_MAX;
          const tyreCapped = isTraining && sk === "tyreMgmt" && value >= tyreMgmtEffectiveCap && value < ABSOLUTE_SKILL_MAX;
          const disabled = isTraining && (busy || (!!activeSkill && !isActive) || (maxed && !isActive));
          const hint = isTraining && sk ? skillHint(sk) : "";
          const onClick = () => {
            if (b.role === "race") {
              onRace();
            } else if (isActive) {
              handleCancel();
            } else if (!disabled && sk) {
              handleStart(sk);
            }
          };
          return (
            <button
              key={b.id}
              className={[
                styles.building,
                b.role === "race" ? styles.race : "",
                isActive ? styles.activeB : "",
                disabled ? styles.dim : "",
              ].filter(Boolean).join(" ")}
              style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
              disabled={isTraining && disabled}
              aria-label={isTraining ? `${b.name} — ${skillLabel(sk!)} ${value}/${ABSOLUTE_SKILL_MAX}` : "Гонка"}
              title={isTraining && hint ? `${skillLabel(sk!)} (${value}/${ABSOLUTE_SKILL_MAX}): ${hint}` : undefined}
              onClick={onClick}
            >
              <img className={styles.buildingImg} src={b.img} alt="" draggable={false} />
              <span className={styles.badge}>
                {b.role === "race" ? (
                  <span className={styles.raceBadge}>ГОНКА</span>
                ) : maxed ? (
                  <span className={styles.maxBadge}>MAX</span>
                ) : (
                  <>
                    <span className={styles.badgeName}>{b.name}</span>
                    <span className={styles.badgeVal}>{value}/{ABSOLUTE_SKILL_MAX}</span>
                    {tyreCapped && <span className={styles.capDot} title="Эффективный потолок на 15">◆</span>}
                  </>
                )}
              </span>
              {isTraining && hint && (
                <span className={styles.buildingHint}>{hint}</span>
              )}
              {isActive && (
                <span className={styles.timer} aria-live="polite">
                  {fmtRemaining(remaining)}
                </span>
              )}
              {isActive && <span className={styles.cancelHint}>отменить</span>}
            </button>
          );
        })}
      </div>
      {showStats && <PilotStatsModal profile={localProfile} onClose={() => setShowStats(false)} />}
    </div>
  );
}
