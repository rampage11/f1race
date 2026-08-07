import { useEffect, useState } from "react";
import { useReducedMotion } from "../lib/useReducedMotion";
import styles from "./StartupLights.module.css";

const KEY = "f1race.lights.played";
const STEP_MS = 250;
const HOLD_AFTER_LAST_MS = 400;
const FADE_MS = 300;

export function StartupLights() {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState<boolean[]>([false, false, false, false, false]);
  const [fading, setFading] = useState(false);
  const [done, setDone] = useState<boolean>(() => {
    if (reduced) return true;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(KEY) !== null) return true;
    } catch {
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (done) return;
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(KEY, "1");
    } catch {
      setDone(true);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < 5; i++) {
      const idx = i;
      timers.push(
        setTimeout(() => {
          setLit((prev) => {
            const next = prev.slice();
            next[idx] = true;
            return next;
          });
        }, idx * STEP_MS),
      );
    }
    const extinguishAt = 4 * STEP_MS + HOLD_AFTER_LAST_MS;
    timers.push(
      setTimeout(() => {
        setLit([false, false, false, false, false]);
        setFading(true);
      }, extinguishAt),
    );
    timers.push(setTimeout(() => setDone(true), extinguishAt + FADE_MS));
    return () => timers.forEach(clearTimeout);
  }, [done]);

  if (done) return null;

  return (
    <div
      className={[styles.overlay, fading ? styles.fading : ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <div className={styles.row}>
        {lit.map((on, i) => (
          <span
            key={i}
            className={[styles.light, on ? styles.lit : ""].filter(Boolean).join(" ")}
          />
        ))}
      </div>
    </div>
  );
}
