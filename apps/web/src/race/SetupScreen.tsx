import { useState } from "react";
import type { PilotProfile, SkillKey, Skills, TyreCompound } from "@f1race/race-engine";
import { emptySkills, estimateTyreLifespanLaps, recommendedLaps, redBullRing } from "@f1race/race-engine";
import { teamColor, TYRE_COLORS, TYRE_LABEL } from "./colors";
import { yandexClientId } from "../identity";
import type { DriverProfileSummary } from "../identity";
import { SKILL_META } from "../skills";

const STARTING_POINTS = 10;
const MAX_PER_SKILL = 5;

const COUNTRIES: { code: string; flag: string; name: string }[] = [
  { code: "RU", flag: "🇷🇺", name: "Россия" },
  { code: "GB", flag: "🇬🇧", name: "Великобритания" },
  { code: "NL", flag: "🇳🇱", name: "Нидерланды" },
  { code: "MC", flag: "🇲🇨", name: "Монако" },
  { code: "ES", flag: "🇪🇸", name: "Испания" },
  { code: "FR", flag: "🇫🇷", name: "Франция" },
  { code: "DE", flag: "🇩🇪", name: "Германия" },
  { code: "IT", flag: "🇮🇹", name: "Италия" },
  { code: "FI", flag: "🇫🇮", name: "Финляндия" },
  { code: "BR", flag: "🇧🇷", name: "Бразилия" },
  { code: "AU", flag: "🇦🇺", name: "Австралия" },
  { code: "JP", flag: "🇯🇵", name: "Япония" },
  { code: "CA", flag: "🇨🇦", name: "Канада" },
  { code: "MX", flag: "🇲🇽", name: "Мексика" },
  { code: "TH", flag: "🇹🇭", name: "Таиланд" },
  { code: "CN", flag: "🇨🇳", name: "Китай" },
  { code: "US", flag: "🇺🇸", name: "США" },
  { code: "AR", flag: "🇦🇷", name: "Аргентина" },
];

const TEAMS = [
  "Red Bull",
  "Ferrari",
  "Mercedes",
  "McLaren",
  "Aston Martin",
  "Alpine",
  "Williams",
  "AlphaTauri",
  "Sauber",
  "Haas",
];

const DEFAULTS: PilotProfile = {
  name: "",
  country: "RU",
  team: "McLaren",
  skills: { ...emptySkills(), pace: 3, attack: 2, defense: 2, fitness: 1, reaction: 1, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

export interface SetupScreenProps {
  onStart: (cfg: PilotProfile) => void;
  initialHero?: PilotProfile;
  authProfile?: DriverProfileSummary | null;
  onLoginYandex?: () => void;
  onLogout?: () => void;
  mode?: "full" | "onboarding";
  submitting?: boolean;
  submitError?: string | null;
}

export function SetupScreen({
  onStart,
  initialHero,
  authProfile,
  onLoginYandex,
  onLogout,
  mode = "full",
  submitting = false,
  submitError = null,
}: SetupScreenProps) {
  const [cfg, setCfg] = useState<PilotProfile>(initialHero ?? DEFAULTS);
  const track = redBullRing();
  const lapKm = track.lengthM / 1000;
  const laps = recommendedLaps(track);
  const lifespan = (c: TyreCompound) => estimateTyreLifespanLaps(c, cfg.skills.tyreMgmt, lapKm);

  const used = sum(cfg.skills);
  const remaining = STARTING_POINTS - used;
  const nameValid = cfg.name.trim().length >= 2;
  const pointsValid = remaining === 0;
  const canStart = nameValid && pointsValid;

  const isOnboarding = mode === "onboarding";
  const showYandexButton = !isOnboarding && !authProfile && !!yandexClientId() && !!onLoginYandex;
  const showAuthRow = !isOnboarding && !!authProfile && !!authProfile.hero.name;
  const authName = authProfile?.hero.name ?? null;

  const setSkill = (key: SkillKey, delta: number) => {
    setCfg((c) => {
      const next = Math.max(0, Math.min(MAX_PER_SKILL, c.skills[key] + delta));
      if (next === c.skills[key]) return c;
      const draft = { ...c.skills, [key]: next };
      if (sum(draft) > STARTING_POINTS) return c;
      return { ...c, skills: draft };
    });
  };

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>Создание пилота</h1>
        <p className="sub">
          {isOnboarding
            ? "Создайте своего пилота — это разовое решение на весь аккаунт"
            : `Формула 4 · Red Bull Ring · ${laps} кругов (~${Math.round(lapKm * laps)} км) · 1 обязательный пит-стоп со сменой состава · без регистрации`}
        </p>

        {showAuthRow && authName && (
          <div className="auth-row">
            <span className="auth-chip">
              <svg className="ya-badge-sm" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="24" height="24" rx="4" fill="#FC3F1D" />
                <text x="12" y="17" textAnchor="middle" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#fff">Я</text>
              </svg>
              <span className="auth-chip-text">Вы вошли как <strong>{authName}</strong></span>
              {authProfile && authProfile.division && <span className="auth-chip-div">{authProfile.division} · Ур. {authProfile.level}</span>}
            </span>
            {onLogout && (
              <button className="auth-logout" onClick={onLogout}>Выйти</button>
            )}
          </div>
        )}

        {!isOnboarding && initialHero && <p className="welcome-back">С возвращением, {initialHero.name}! Профиль загружен — можно править.</p>}

        <label className="field">
          <span>Имя пилота</span>
          <input
            type="text"
            placeholder="Например, Мика"
            value={cfg.name}
            maxLength={18}
            onChange={(e) => setCfg({ ...cfg, name: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Страна</span>
          <select value={cfg.country} onChange={(e) => setCfg({ ...cfg, country: e.target.value })}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Команда-академия</span>
          <div className="teams">
            {TEAMS.map((t) => (
              <button
                key={t}
                className={`team ${t === cfg.team ? "selected" : ""}`}
                style={{ borderColor: t === cfg.team ? teamColor(t) : undefined }}
                onClick={() => setCfg({ ...cfg, team: t })}
              >
                <span className="team-dot" style={{ background: teamColor(t) }} />
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="row-label">
            Навыки
            <em>осталось очков: <strong className={remaining === 0 ? "ok" : "warn"}>{remaining}</strong></em>
          </span>
          <div className="skills">
            {SKILL_META.map((s) => (
              <div className="skill" key={s.key}>
                <div className="skill-head">
                  <span className="skill-name">{s.label}</span>
                  <span className="skill-hint">{s.hint}</span>
                </div>
                <div className="skill-ctrl">
                  <button disabled={cfg.skills[s.key] <= 0} onClick={() => setSkill(s.key, -1)}>−</button>
                  <div className="pips">
                    {Array.from({ length: MAX_PER_SKILL }, (_, i) => (
                      <span key={i} className={`pip ${i < cfg.skills[s.key] ? "on" : ""}`} />
                    ))}
                  </div>
                  <button disabled={cfg.skills[s.key] >= MAX_PER_SKILL || remaining <= 0} onClick={() => setSkill(s.key, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {!isOnboarding && (
          <div className="field">
            <span>Стартовая резина <em className="lifespan-hint">≈ {lifespan(cfg.startingTyre)} кругов до деградации</em></span>
            <div className="tyre-pick">
              {(["soft", "medium", "hard"] as TyreCompound[]).map((c) => (
                <button
                  key={c}
                  className={`tyre-pick-btn ${c === cfg.startingTyre ? "selected" : ""}`}
                  style={{ borderColor: c === cfg.startingTyre ? TYRE_COLORS[c] : undefined }}
                  onClick={() => {
                    const next = { ...cfg, startingTyre: c };
                    if (next.pitCompound === c) next.pitCompound = c === "soft" ? "medium" : "soft";
                    setCfg(next);
                  }}
                >
                  <span className="dot" style={{ background: TYRE_COLORS[c] }} />
                  <span className="tyre-name">{TYRE_LABEL[c]}</span>
                  <small className="tyre-life">~{lifespan(c)} кр</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isOnboarding && (
          <div className="field strategy-note">
            <span>Стратегия пит-стопа</span>
            <p className="hint">
              Состав на пит выбирается <strong>во время гонки</strong> (панель «Пит-стоп»). Soft быстр, но умирает через ~{lifespan("soft")} круг. — обычно питаться на {lifespan("soft")}-{lifespan("soft") + 1}-м круге. По правилу Ф1 состав нужно <strong>сменить</strong>.
            </p>
          </div>
        )}

        {showYandexButton && (
          <div className="oauth-login-row">
            <button type="button" className="yandex-btn" onClick={onLoginYandex}>
              <svg className="ya-badge" viewBox="0 0 24 24" aria-hidden="true">
                <rect width="24" height="24" rx="4" fill="#FC3F1D" />
                <text x="12" y="17" textAnchor="middle" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#fff">Я</text>
              </svg>
              Войти через Яндекс
            </button>
            <p className="oauth-hint">Опционально: сохранит прогресс и уровень между визитами.</p>
          </div>
        )}

        <button
          className="start-btn"
          disabled={!canStart || submitting}
          onClick={() => onStart(cfg)}
        >
          {submitting ? "Сохранение…" : isOnboarding ? "Подтвердить и продолжить →" : "На стартовую решётку →"}
        </button>
        {submitError && <p className="warn-text">{submitError}</p>}
        {!nameValid && <p className="warn-text">Введите имя (минимум 2 символа)</p>}
        {!pointsValid && nameValid && <p className="warn-text">Распределите все {STARTING_POINTS} очков</p>}
      </div>
    </div>
  );
}

function sum(s: Skills): number {
  return s.fitness + s.reaction + s.attack + s.defense + s.pace + s.tyreMgmt;
}
