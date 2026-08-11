import { useEffect, useState, type CSSProperties } from "react";
import type { PushStrategy } from "@f1race/race-engine";
import { isTouchDevice } from "./device";

const IS_TOUCH = isTouchDevice();

const STORAGE_KEY = "f1race.pushStrategy";

interface ModeMeta {
  key: PushStrategy;
  label: string;
  short: string;
  color: string;
}

const MODES: ModeMeta[] = [
  { key: "conservative", label: "Консервативно", short: "K", color: "var(--accent-blue)" },
  { key: "balanced", label: "Баланс", short: "B", color: "var(--accent-green)" },
  { key: "attack", label: "Атака", short: "A", color: "var(--accent-red)" },
];

function readStored(): PushStrategy | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "conservative" || v === "balanced" || v === "attack") return v;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

function writeStored(strategy: PushStrategy): void {
  try {
    localStorage.setItem(STORAGE_KEY, strategy);
  } catch {
    /* localStorage unavailable */
  }
}

export function PushStrategySelect({
  current,
  disabled,
  onSelect,
}: {
  current: PushStrategy | undefined;
  disabled: boolean;
  onSelect: (strategy: PushStrategy) => void;
}) {
  const active: PushStrategy = current ?? readStored() ?? "balanced";
  const [local, setLocal] = useState<PushStrategy>(active);

  useEffect(() => {
    if (current) setLocal(current);
  }, [current]);

  const pick = (s: PushStrategy) => {
    if (disabled) return;
    setLocal(s);
    writeStored(s);
    onSelect(s);
  };

  return (
    <div className="push-wrap" role="group" aria-label="Стратегия на отрезок">
      <div className="push-modes">
        {MODES.map((m) => {
          const isActive = local === m.key;
          return (
            <button
              key={m.key}
              className={`push-mode-btn${isActive ? " push-mode-active" : ""}`}
              onClick={() => pick(m.key)}
              disabled={disabled}
              title={IS_TOUCH ? m.label : `${m.label} (стратегия на отрезок)`}
              aria-pressed={isActive}
              aria-label={`Стратегия: ${m.label}`}
              style={{ "--mode-color": m.color } as CSSProperties}
            >
              <span className="push-mode-short ds-mono">{m.short}</span>
              <span className="push-mode-label">{m.label}</span>
            </button>
          );
        })}
      </div>
      <div className="push-hint ds-microtext">
        Стратегия на отрезок: Атака быстрее, но сильнее изнашивает резину.
      </div>
    </div>
  );
}
