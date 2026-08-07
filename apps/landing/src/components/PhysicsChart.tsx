import { useMemo, useRef, useState } from "react";
import { LAP, colorForSpeed } from "../lib/lap-data";
import { useInView } from "../lib/useInView";
import { useReducedMotion } from "../lib/useReducedMotion";
import styles from "./PhysicsChart.module.css";

const Y_MIN = 100;
const Y_MAX = 320;
const Y_TICKS = [100, 160, 220, 280];
const X_TICKS = [
  { d: 0, l: "0" },
  { d: 2000, l: "2.0" },
  { d: 4000, l: "4.0" },
  { d: 6000, l: "6.0" },
];
const MAX_BRAKE = 26;

const W = 820;
const H = 300;
const PAD_L = 46;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 34;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const sx = (d: number): number => PAD_L + (d / LAP.lengthM) * PLOT_W;
const sy = (v: number): number => PAD_T + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H;

export function PhysicsChart() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, 0.2);
  const reduced = useReducedMotion();
  const revealed = reduced || inView;
  const [mobileOpen, setMobileOpen] = useState(false);

  const geom = useMemo(() => {
    const pts = LAP.speed.map((s) => [sx(s.dM), sy(s.kmh)] as const);
    const segs: { x1: number; y1: number; x2: number; y2: number; stroke: string }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const midKmh = (LAP.speed[i].kmh + LAP.speed[i + 1].kmh) / 2;
      segs.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: colorForSpeed(midKmh) });
    }
    const baseline = PAD_T + PLOT_H;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L ${last[0].toFixed(1)} ${baseline.toFixed(1)} L ${first[0].toFixed(1)} ${baseline.toFixed(1)} Z`;
    return { segs, areaPath };
  }, []);

  const maxKmh = Math.round(LAP.speedMax);

  return (
    <div ref={ref} className={styles.wrap}>
      <div className={[styles.chartHolder, mobileOpen ? styles.chartHolderOpen : ""].filter(Boolean).join(" ")}>
        <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="График скорости по дистанции круга">
          <defs>
            <linearGradient id="pc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-speed-fast)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--c-speed-fast)" stopOpacity="0" />
            </linearGradient>
            <clipPath id="pc-clip">
              <rect
                className={styles.clipRect}
                x={PAD_L}
                y={PAD_T}
                height={PLOT_H}
                style={{ width: revealed ? PLOT_W : 0 }}
              />
            </clipPath>
          </defs>

          {Y_TICKS.map((t) => (
            <g key={t}>
              <line className={styles.grid} x1={PAD_L} y1={sy(t)} x2={PAD_L + PLOT_W} y2={sy(t)} />
              <text className={`mono ${styles.tickLabel}`} x={PAD_L - 8} y={sy(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}

          {X_TICKS.map((t) => (
            <text
              key={t.d}
              className={`mono ${styles.tickLabel}`}
              x={sx(t.d)}
              y={PAD_T + PLOT_H + 20}
              textAnchor="middle"
            >
              {t.l}
            </text>
          ))}

          <text className={`mono ${styles.axisTitle}`} x={PAD_L + PLOT_W} y={H - 4} textAnchor="end">
            км
          </text>
          <text className={`mono ${styles.axisTitle}`} x={PAD_L} y={PAD_T - 6} textAnchor="start">
            км/ч
          </text>

          <g clipPath="url(#pc-clip)">
            <path className={styles.area} d={geom.areaPath} fill="url(#pc-area)" />
            {geom.segs.map((s, i) => (
              <line
                key={i}
                x1={s.x1}
                y1={s.y1}
                x2={s.x2}
                y2={s.y2}
                stroke={s.stroke}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            ))}
          </g>

          <rect className={styles.frame} x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} />
        </svg>
      </div>

      <ul className={styles.facts}>
        <li className={styles.fact}>
          <span className={styles.factDot} />
          <span>
            <span className={styles.factStrong}>Торможение</span> считается от дистанции до поворота, не от таймера.
          </span>
        </li>
        <li className={styles.fact}>
          <span className={styles.factDot} />
          <span>
            <span className={styles.factStrong}>Износ резины</span> зависит от состава: soft, medium, hard.
          </span>
        </li>
        <li className={styles.fact}>
          <span className={styles.factDot} />
          <span>
            <span className={styles.factStrong}>Обгоны</span> — вероятностная модель на темпе и защите.
          </span>
        </li>
      </ul>

      <div className={styles.mobile}>
        <div className={styles.bigGrid}>
          <div className={styles.big}>
            <div className={`mono ${styles.bigNum}`}>
              {maxKmh}
              <span className={styles.bigUnit}>км/ч</span>
            </div>
            <div className={styles.bigLabel}>макс на прямой</div>
          </div>
          <div className={styles.big}>
            <div className={`mono ${styles.bigNum}`}>
              {LAP.speedMin}
              <span className={styles.bigUnit}>км/ч</span>
            </div>
            <div className={styles.bigLabel}>в шпильке</div>
          </div>
          <div className={styles.big}>
            <div className={`mono ${styles.bigNum}`}>
              −{MAX_BRAKE}
              <span className={styles.bigUnit}>м/с²</span>
            </div>
            <div className={styles.bigLabel}>пик торможения</div>
          </div>
        </div>
        <button type="button" className={styles.expand} onClick={() => setMobileOpen((v) => !v)}>
          {mobileOpen ? "Свернуть график" : "Развернуть график"}
        </button>
      </div>
    </div>
  );
}
