import { useCallback, useEffect, useRef, useState } from "react";
import type { MyStartResult } from "./useRaceSession";

const POST_BUFFER_MS = 5000;

interface Props {
  lightsOutAt: number;
  sequenceId: number;
  myStartResult: MyStartResult | null;
  reacted: boolean;
  onReact: () => void;
}

export function StartLights({ lightsOutAt, sequenceId, myStartResult, reacted, onReact }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [seqStart] = useState(() => Date.now());
  const [localJump, setLocalJump] = useState(false);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = Date.now();
      setNow(t);
      if (t < lightsOutAt + POST_BUFFER_MS) {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lightsOutAt, sequenceId]);

  useEffect(() => {
    setLocalJump(false);
  }, [sequenceId]);

  const handleReact = useCallback(() => {
    if (reacted) return;
    if (Date.now() < lightsOutAt) setLocalJump(true);
    onReact();
  }, [reacted, lightsOutAt, onReact]);

  const handleReactRef = useRef(handleReact);
  handleReactRef.current = handleReact;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        handleReactRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lightsOut = now >= lightsOutAt;
  const lit = [0, 1, 2, 3, 4].map((i) => !lightsOut && now >= seqStart + (i + 1) * 1000);

  return (
    <div
      className="start-lights-overlay"
      role="button"
      aria-label="Реагировать на старт"
      onClick={() => handleReactRef.current()}
    >
      <div className="start-lights-card">
        <div className={`lights-row ${lightsOut ? "out" : ""}`}>
          {lit.map((on, i) => (
            <span key={i} className={`light ${on ? "on" : ""}`} />
          ))}
        </div>
        <div className="lights-message">
          {myStartResult ? (
            <>
              <div className="reaction-time">{myStartResult.reactionSec.toFixed(3)} с</div>
              {myStartResult.jumpStart && <div className="jump-warning">Фальстарт — штраф</div>}
            </>
          ) : reacted ? (
            <>
              <div className="waiting">✓ реакция принята, ожидание…</div>
              {localJump && <div className="jump-warning">Клик до огней — ждём решения сервера</div>}
            </>
          ) : lightsOut ? (
            <div className="go">GO!</div>
          ) : now < seqStart + 1000 ? (
            <div className="prompt">Приготовиться…</div>
          ) : (
            <div className="prompt">Красные загораются — реагируй на погасание</div>
          )}
        </div>
        <div className="lights-hint">Space / Enter / клик</div>
      </div>
    </div>
  );
}
