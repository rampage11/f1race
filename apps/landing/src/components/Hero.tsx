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
          <h1 className={styles.title}>Гонка, которую считает сервер, не сценарист</h1>
          <p className={styles.subtitle}>
            Торможение по факту дистанции, износ резины, обгоны по вероятностной модели — каждый
            круг считает сервер.
          </p>
          <CtaButton />
        </div>
      </div>
    </section>
  );
}
