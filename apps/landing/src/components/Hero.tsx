import { CtaButton } from "./CtaButton";
import { TelemetryStrip } from "./TelemetryStrip";
import { SpeedRibbon } from "./SpeedRibbon";
import { StartupLights } from "./StartupLights";
import styles from "./Hero.module.css";

export function Hero() {
  return (
    <section className={styles.hero}>
      <StartupLights />

      <div className={styles.stripRegion}>
        <TelemetryStrip />
        <div className={styles.fade} />
      </div>

      <div className={styles.ribbonRegion}>
        <SpeedRibbon />
      </div>

      <div className={`container ${styles.body}`}>
        <div className={styles.content}>
          <h1 className={styles.title}>
            Ты не рулишь. Ты <span className={styles.highlight}>решаешь</span>.
          </h1>
          <p className={styles.subtitle}>
            Торможения, износ резины, дождь, обгоны и пит-стопы — всё по-настоящему.
            А на трассе побеждает стратегия, а не рефлекс.
          </p>
          <CtaButton />
        </div>
      </div>
    </section>
  );
}
