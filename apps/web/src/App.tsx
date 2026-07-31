import { useState } from "react";
import { SetupScreen } from "./race/SetupScreen";
import { RaceView } from "./race/RaceView";
import type { HeroConfig } from "./race/useRaceEngine";

export default function App() {
  const [hero, setHero] = useState<HeroConfig | null>(null);

  if (!hero) {
    return (
      <SetupScreen onStart={(cfg) => setHero(cfg)} />
    );
  }
  return <RaceView hero={hero} onChangeDriver={() => setHero(null)} />;
}
