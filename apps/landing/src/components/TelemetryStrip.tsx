import { useEffect, useMemo, useRef } from "react";
import { LAP, pointAt, speedAtFraction, colorForSpeed } from "../lib/lap-data";
import { useReducedMotion } from "../lib/useReducedMotion";
import styles from "./TelemetryStrip.module.css";

const SAMPLES = 240;
const TRAIL = 14;
const TRAIL_STEP = 0.0045;
const DURATION = 12000;
const STATIC_FRAC = 0.62;
const PAD = 40;

const wrap = (f: number): number => ((f % 1) + 1) % 1;

export function TelemetryStrip() {
  const reduced = useReducedMotion();
  const dotRef = useRef<SVGCircleElement | null>(null);
  const trailRefs = useRef<Array<SVGCircleElement | null>>([]);

  const contourD = useMemo(() => {
    let d = "";
    for (let i = 0; i < SAMPLES; i++) {
      const p = pointAt(i / SAMPLES);
      d += i === 0 ? `M${p.x.toFixed(2)} ${p.y.toFixed(2)}` : ` L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }
    return d + " Z";
  }, []);

  const viewBox = useMemo(() => {
    const { minX, minY, maxX, maxY } = LAP.bounds;
    return `${minX - PAD} ${minY - PAD} ${maxX - minX + PAD * 2} ${maxY - minY + PAD * 2}`;
  }, []);

  const sf = useMemo(() => pointAt(0), []);
  const sfHalf = 16;
  const sfnx = Math.cos(sf.angle + Math.PI / 2) * sfHalf;
  const sfny = Math.sin(sf.angle + Math.PI / 2) * sfHalf;

  const initFrac = reduced ? STATIC_FRAC : 0;
  const initDot = pointAt(initFrac);
  const initDotColor = colorForSpeed(speedAtFraction(initFrac));

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const frac = wrap((now - start) / DURATION);
      const dp = pointAt(frac);
      if (dotRef.current) {
        dotRef.current.setAttribute("cx", dp.x.toFixed(2));
        dotRef.current.setAttribute("cy", dp.y.toFixed(2));
        dotRef.current.setAttribute("fill", colorForSpeed(speedAtFraction(frac)));
      }
      for (let i = 0; i < TRAIL; i++) {
        const el = trailRefs.current[i];
        if (!el) continue;
        const tf = wrap(frac - (i + 1) * TRAIL_STEP);
        const tp = pointAt(tf);
        el.setAttribute("cx", tp.x.toFixed(2));
        el.setAttribute("cy", tp.y.toFixed(2));
        el.setAttribute("fill", colorForSpeed(speedAtFraction(tf)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <div className={styles.strip}>
      <div className={styles.art}>
        <svg
          className={styles.svg}
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <filter id="ts-dot-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="8" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path className={styles.trackOuter} d={contourD} />
          <path className={styles.trackInner} d={contourD} />

          <line
            className={styles.sfLine}
            x1={(sf.x - sfnx).toFixed(2)}
            y1={(sf.y - sfny).toFixed(2)}
            x2={(sf.x + sfnx).toFixed(2)}
            y2={(sf.y + sfny).toFixed(2)}
          />

          {Array.from({ length: TRAIL }, (_, i) => {
            const f = wrap(initFrac - (i + 1) * TRAIL_STEP);
            const p = pointAt(f);
            const op = (1 - i / TRAIL) * 0.5;
            const r = Math.max(2.5, 9 - i * 0.45);
            return (
              <circle
                key={i}
                ref={(el) => {
                  trailRefs.current[i] = el;
                }}
                cx={p.x.toFixed(2)}
                cy={p.y.toFixed(2)}
                r={r}
                fill={colorForSpeed(speedAtFraction(f))}
                opacity={op}
              />
            );
          })}

          <circle
            ref={dotRef}
            cx={initDot.x.toFixed(2)}
            cy={initDot.y.toFixed(2)}
            r={12}
            fill={initDotColor}
            filter="url(#ts-dot-glow)"
          />
        </svg>
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
