import { Hero } from "./components/Hero";
import { PhysicsChart } from "./components/PhysicsChart";
import { LobbyPreview } from "./components/LobbyPreview";
import { SkillBars } from "./components/SkillBars";
import { FinishSection } from "./components/FinishSection";
import { StickyCta } from "./components/StickyCta";
import styles from "./App.module.css";

export function App() {
  return (
    <>
      <main>
        <Hero />
        <PhysicsChart />
        <LobbyPreview />
        <SkillBars />
        <FinishSection />
      </main>
      <footer className={styles.footer}>
        <div className="container">
          <span className={`mono ${styles.brand}`}>F1RACE</span>
          <nav className={styles.legal}>
            <a href="/" aria-disabled="true">
              Юридическая информация
            </a>
          </nav>
        </div>
      </footer>
      <StickyCta />
    </>
  );
}
