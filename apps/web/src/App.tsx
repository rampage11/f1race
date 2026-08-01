import { useState } from "react";
import type { PilotProfile } from "@f1race/race-engine";
import { SetupScreen } from "./race/SetupScreen";
import { RaceView } from "./race/RaceView";

export default function App() {
  const [hero, setHero] = useState<PilotProfile | null>(null);

  if (!hero) {
    return (
      <SetupScreen onStart={(cfg) => setHero(cfg)} />
    );
  }
  return <RaceView hero={hero} onChangeDriver={() => setHero(null)} />;
}
