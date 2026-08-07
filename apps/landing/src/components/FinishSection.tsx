import { Section } from "./Section";
import { CtaButton } from "./CtaButton";
import styles from "./FinishSection.module.css";

export function FinishSection() {
  return (
    <Section id="finish" label="FINISH" bare bg="/img/finish.webp">
      <div className="container">
        <div className={styles.finish}>
          <svg
            className={styles.flag}
            viewBox="0 0 480 120"
            role="img"
            aria-label="Клетчатый флаг"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <pattern id="fin-checker" width="32" height="32" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" x="0" y="0" fill="var(--c-text)" fillOpacity="0.07" />
                <rect width="16" height="16" x="16" y="16" fill="var(--c-text)" fillOpacity="0.07" />
              </pattern>
              <linearGradient id="fin-fade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fff" stopOpacity="0" />
                <stop offset="18%" stopColor="#fff" stopOpacity="1" />
                <stop offset="82%" stopColor="#fff" stopOpacity="1" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask id="fin-mask">
                <rect width="480" height="120" fill="url(#fin-fade)" />
              </mask>
            </defs>
            <rect width="480" height="120" fill="url(#fin-checker)" mask="url(#fin-mask)" />
          </svg>

          <p className={styles.line}>Гонка, которую считает сервер.</p>
          <CtaButton />
        </div>
      </div>
    </Section>
  );
}
