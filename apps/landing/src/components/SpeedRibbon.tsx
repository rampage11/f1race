import { useEffect, useMemo, useRef } from "react";
import { colorForSpeed, speedAtFraction } from "../lib/lap-data";
import { useReducedMotion } from "../lib/useReducedMotion";
import styles from "./SpeedRibbon.module.css";

const SEGMENTS = 60;
const DURATION = 8000;
const STATIC_FRAC = 0.62;

const wrap = (f: number): number => ((f % 1) + 1) % 1;

export function SpeedRibbon() {
  const reduced = useReducedMotion();
  const markerRef = useRef<HTMLDivElement | null>(null);

  const gradient = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const f = i / SEGMENTS;
      stops.push(`${colorForSpeed(speedAtFraction(f))} ${(f * 100).toFixed(2)}%`);
    }
    return `linear-gradient(to right, ${stops.join(",")})`;
  }, []);

  const initFrac = reduced ? STATIC_FRAC : 0;

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const frac = wrap((now - start) / DURATION);
      const el = markerRef.current;
      if (el) {
        el.style.left = `${(frac * 100).toFixed(2)}%`;
        el.style.background = colorForSpeed(speedAtFraction(frac));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div className={styles.ribbon}>
      <div className={styles.wrap}>
        <div className={styles.bar} style={{ background: gradient }} />
        <div
          ref={markerRef}
          className={styles.marker}
          style={{
            left: `${(initFrac * 100).toFixed(2)}%`,
            background: colorForSpeed(speedAtFraction(initFrac)),
          }}
        />
      </div>

      <div className={styles.legend}>
        <span className={styles.legendText}>ГАЗ → ТОРМОЖЕНИЕ</span>
        <span className={styles.swatches}>
          <i style={{ background: "var(--c-speed-fast)" }} />
          <i style={{ background: "var(--c-speed-mid)" }} />
          <i style={{ background: "var(--c-speed-slow)" }} />
        </span>
      </div>
    </div>
  );
}
