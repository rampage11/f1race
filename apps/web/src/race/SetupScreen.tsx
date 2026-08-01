import { useState } from "react";
import type { PilotProfile, SkillKey, Skills, TyreCompound } from "@f1race/race-engine";
import { emptySkills, estimateTyreLifespanLaps, recommendedLaps, redBullRing } from "@f1race/race-engine";
import { teamColor, TYRE_COLORS, TYRE_LABEL } from "./colors";

const STARTING_POINTS = 10;
const MAX_PER_SKILL = 5;

const SKILL_META: { key: SkillKey; label: string; hint: string }[] = [
  { key: "fitness", label: "Выносливость", hint: "Стабильность к концу гонки" },
  { key: "reaction", label: "Реакция", hint: "Старт и рестарты" },
  { key: "attack", label: "Атака", hint: "Эффективность обгонов" },
  { key: "defense", label: "Защита", hint: "Удержание позиции" },
  { key: "pace", label: "Пилотирование", hint: "Чистое время круга, квала" },
  { key: "tyreMgmt", label: "Бережливость", hint: "Срок жизни резины" },
];

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

export function SetupScreen({ onStart }: { onStart: (cfg: PilotProfile) => void }) {
  const [cfg, setCfg] = useState<PilotProfile>(DEFAULTS);
  const track = redBullRing();
  const lapKm = track.lengthM / 1000;
  const laps = recommendedLaps(track);
  const lifespan = (c: TyreCompound) => estimateTyreLifespanLaps(c, cfg.skills.tyreMgmt, lapKm);

  const used = sum(cfg.skills);
  const remaining = STARTING_POINTS - used;
  const nameValid = cfg.name.trim().length >= 2;
  const pointsValid = remaining === 0;
  const canStart = nameValid && pointsValid;

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
        <p className="sub">Формула 4 · Red Bull Ring · {laps} кругов (~{Math.round(lapKm * laps)} км) · 1 обязательный пит-стоп со сменой состава · без регистрации</p>

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

        <div className="field strategy-note">
          <span>Стратегия пит-стопа</span>
          <p className="hint">
            Состав на пит выбирается <strong>во время гонки</strong> (панель «Пит-стоп»). Soft быстр, но умирает через ~{lifespan("soft")} круг. — обычно питаться на {lifespan("soft")}-{lifespan("soft") + 1}-м круге. По правилу Ф1 состав нужно <strong>сменить</strong>.
          </p>
        </div>

        <button className="start-btn" disabled={!canStart} onClick={() => onStart(cfg)}>
          На стартовую решётку →
        </button>
        {!nameValid && <p className="warn-text">Введите имя (минимум 2 символа)</p>}
        {!pointsValid && nameValid && <p className="warn-text">Распределите все {STARTING_POINTS} очков</p>}
      </div>
    </div>
  );
}

function sum(s: Skills): number {
  return s.fitness + s.reaction + s.attack + s.defense + s.pace + s.tyreMgmt;
}
