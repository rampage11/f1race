import { useEffect, type CSSProperties } from "react";
import type { HammerMode } from "@f1race/race-engine";
import type { SessionCar } from "./useRaceSession";

const SIZE = 80;
const RING_R = 36;
const RING_CIRC = 2 * Math.PI * RING_R;

type HammerState = "available" | "active" | "cooldown";

interface ModeMeta {
  key: HammerMode;
  label: string;
  short: string;
  color: string;
  hint: string;
}

const MODES: ModeMeta[] = [
  { key: "attack", label: "Атака", short: "A", color: "var(--accent-red)", hint: "Шанс обгона" },
  { key: "defend", label: "Оборона", short: "D", color: "var(--accent-purple)", hint: "Удержать позицию" },
  { key: "push", label: "Темп", short: "P", color: "var(--accent-orange)", hint: "Быстрый круг" },
];

function classify(car: SessionCar | null | undefined): HammerState {
  const h = car?.hammerTime;
  if (!h) return "available";
  if (h.active) return "active";
  if (h.remainingSec > 0) return "cooldown";
  return "available";
}

export function HammerButton({
  hero,
  onRequest,
}: {
  hero: SessionCar | null;
  onRequest: (mode: HammerMode) => void;
}) {
  const state = classify(hero);
  const h = hero?.hammerTime;
  const activeMode = h?.mode ?? null;
  const activeMeta = MODES.find((m) => m.key === activeMode) ?? null;

  useEffect(() => {
    if (state !== "available") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        e.preventDefault();
        onRequest("push");
      } else if (e.key === "1") {
        e.preventDefault();
        onRequest("attack");
      } else if (e.key === "2") {
        e.preventDefault();
        onRequest("defend");
      } else if (e.key === "3") {
        e.preventDefault();
        onRequest("push");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onRequest]);

  const remaining = h?.remainingSec ?? 0;
  const cooldownSec = h?.cooldownSec ?? 0;
  const progress = state === "active" && cooldownSec > 0
    ? 1 - Math.max(0, remaining / cooldownSec)
    : state === "cooldown" && cooldownSec > 0
      ? Math.max(0, remaining / cooldownSec)
      : 0;
  const dashOffset = RING_CIRC * (1 - progress);

  const label =
    state === "active" ? remaining.toFixed(1)
    : state === "cooldown" ? `${Math.ceil(remaining)}с`
    : "";
  const ringColor = state === "active" ? (activeMeta?.color ?? "var(--accent-red)") : "var(--accent-green)";

  return (
    <div className="hammer-wrap">
      {state === "available" ? (
        <div className="hammer-modes" role="group" aria-label="Hammer Time режимы">
          {MODES.map((m) => (
            <button
              key={m.key}
              className="hammer-mode-btn"
              onClick={() => onRequest(m.key)}
              title={`${m.label} — ${m.hint} (${m.short}, клавиша ${m.key === "attack" ? "1" : m.key === "defend" ? "2" : "3/Shift"})`}
              aria-label={`Hammer Time: ${m.label}`}
              style={{ "--mode-color": m.color } as CSSProperties}
            >
              <span className="hammer-mode-short ds-mono">{m.short}</span>
              <span className="hammer-mode-label">{m.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          className={`hammer-btn hammer-${state}`}
          title={state === "active" ? `Hammer Time: ${activeMeta?.label ?? ""}` : `Перезарядка ${Math.ceil(remaining)}с`}
          aria-label="Hammer Time"
          style={{ width: SIZE, height: SIZE, "--hammer-color": ringColor } as CSSProperties}
          disabled
        >
          <svg className="hammer-ring" viewBox="0 0 80 80" aria-hidden="true">
            <circle cx="40" cy="40" r={RING_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
            <circle
              cx="40" cy="40" r={RING_R} fill="none"
              stroke={ringColor} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 40 40)"
              style={{ transition: "stroke-dashoffset 0.2s linear" }}
            />
          </svg>
          <svg className="hammer-icon" viewBox="0 0 24 24" aria-hidden="true" style={{ color: ringColor }}>
            <path
              fill="currentColor"
              d="M13.5 2.2c-.4-.2-.8 0-1 .3l-4.3 7.4-2.1-1.2c-.4-.2-.8-.1-1 .3l-.7 1.2c-.2.4-.1.8.3 1l8.7 5c.4.2.8.1 1-.3l.7-1.2c.2-.4.1-.8-.3-1l-2.1-1.2 4.3-7.4c.2-.4 0-.8-.3-1l-1.7-1zM7 14.5L3.2 21c-.3.5 0 1 .6 1h3.4c.4 0 .7-.2.9-.5l3.1-5.4-4.2-2.6-.0-.0z"
            />
          </svg>
          {state === "active" && activeMeta && (
            <span className="hammer-mode-badge ds-mono" style={{ color: activeMeta.color }}>{activeMeta.short}</span>
          )}
          {label && <span className="hammer-count ds-mono">{label}</span>}
        </button>
      )}
    </div>
  );
}
