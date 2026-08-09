import { useEffect } from "react";
import type { SessionCar } from "./useRaceSession";

const SIZE = 80;
const RING_R = 36;
const RING_CIRC = 2 * Math.PI * RING_R;

type HammerState = "available" | "active" | "cooldown";

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
  onRequest: () => void;
}) {
  const state = classify(hero);
  const h = hero?.hammerTime;

  useEffect(() => {
    if (state !== "available") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        e.preventDefault();
        onRequest();
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
  const tooltip =
    state === "available" ? "Hammer Time (Shift)"
    : state === "active" ? "Hammer Time активен!"
    : `Перезарядка ${Math.ceil(remaining)}с`;

  const ringColor = state === "active" ? "var(--accent-red)" : "var(--accent-green)";
  const btnClass = `hammer-btn hammer-${state}${state === "available" ? " ds-pulse" : ""}`;

  return (
    <button
      className={btnClass}
      onClick={() => state === "available" && onRequest()}
      disabled={state !== "available"}
      title={tooltip}
      aria-label="Hammer Time"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg className="hammer-ring" viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r={RING_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
        {(state === "active" || state === "cooldown") && (
          <circle
            cx="40" cy="40" r={RING_R} fill="none"
            stroke={ringColor} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 40 40)"
            style={{ transition: "stroke-dashoffset 0.2s linear" }}
          />
        )}
      </svg>
      <svg className="hammer-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M13.5 2.2c-.4-.2-.8 0-1 .3l-4.3 7.4-2.1-1.2c-.4-.2-.8-.1-1 .3l-.7 1.2c-.2.4-.1.8.3 1l8.7 5c.4.2.8.1 1-.3l.7-1.2c.2-.4.1-.8-.3-1l-2.1-1.2 4.3-7.4c.2-.4 0-.8-.3-1l-1.7-1zM7 14.5L3.2 21c-.3.5 0 1 .6 1h3.4c.4 0 .7-.2.9-.5l3.1-5.4-4.2-2.6-.0-.0z"
        />
      </svg>
      {label && <span className="hammer-count ds-mono">{label}</span>}
    </button>
  );
}
