import { useEffect, useState } from "react";
import { CtaButton } from "./CtaButton";
import styles from "./StickyCta.module.css";

export function StickyCta() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const threshold = () => window.innerHeight * 0.9;
    const update = () => setShown(window.scrollY > threshold());
    update();
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className={[styles.bar, shown ? styles.shown : ""].join(" ")}>
      <CtaButton className={styles.btn} />
    </div>
  );
}
