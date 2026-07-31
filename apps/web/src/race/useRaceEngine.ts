import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RaceEngine,
  baseLapTime,
  buildRaceConfig,
  makeBot,
  makeDriver,
  mulberry32,
  redBullRing,
  runQualifying,
  type Driver,
  type RaceResult,
  type RaceSnapshot,
  type Skills,
  type TyreCompound,
} from "@f1race/race-engine";

export interface HeroConfig {
  name: string;
  country: string;
  team: string;
  skills: Skills;
  startingTyre: TyreCompound;
  pitCompound: TyreCompound;
}

function createDrivers(seed: number, hero: HeroConfig): { drivers: Driver[]; heroId: string } {
  const rng = mulberry32(seed);
  const heroDriver = makeDriver({
    name: hero.name || "Вы",
    country: hero.country,
    kind: "human",
    team: hero.team,
    skills: hero.skills,
    startingTyre: hero.startingTyre,
    pitPlan: { targetStops: 1, strategy: "flexible", compound: hero.pitCompound },
    reactionTimeSec: 0.2,
  });
  const bots: Driver[] = [];
  for (let i = 0; i < 19; i++) bots.push(makeBot({}, rng));
  return { drivers: [heroDriver, ...bots], heroId: heroDriver.id };
}

function buildGrid(drivers: Driver[], seed: number): Driver[] {
  const track = redBullRing();
  const t0 = baseLapTime(track);
  const q = runQualifying(drivers, t0, mulberry32(seed * 7 + 1));
  return q
    .map((row) => drivers.find((d) => d.id === row.driverId)!)
    .sort((a, b) => q.find((r) => r.driverId === a.id)!.gridPosition - q.find((r) => r.driverId === b.id)!.gridPosition);
}

function makeEngine(seed: number, hero: HeroConfig): { engine: RaceEngine; heroId: string } {
  const { drivers, heroId } = createDrivers(seed, hero);
  const grid = buildGrid(drivers, seed);
  const cfg = buildRaceConfig({
    track: redBullRing(),
    drivers: grid,
    totalLaps: 20,
    seed: seed * 13 + 5,
    dt: 0.1,
    heroId,
  });
  return { engine: new RaceEngine(cfg), heroId };
}

export interface RaceControls {
  snapshot: RaceSnapshot | null;
  result: RaceResult | null;
  playing: boolean;
  speed: number;
  heroId: string;
  setPlaying: (b: boolean) => void;
  setSpeed: (n: number) => void;
  requestPit: (compound: TyreCompound) => void;
  cancelPit: () => void;
  restart: () => void;
}

export function useRaceEngine(hero: HeroConfig, initialSpeed = 8): RaceControls {
  const heroRef = useRef<HeroConfig>(hero);
  heroRef.current = hero;
  const seedRef = useRef<number>(42);
  const initial = useMemo(() => makeEngine(seedRef.current, heroRef.current), []);
  const engineRef = useRef<RaceEngine>(initial.engine);
  const heroIdRef = useRef<string>(initial.heroId);

  const [snapshot, setSnapshot] = useState<RaceSnapshot | null>(() => engineRef.current.snapshot());
  const [result, setResult] = useState<RaceResult | null>(null);
  const [playing, setPlayingState] = useState(true);
  const [speed, setSpeedState] = useState(initialSpeed);

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  speedRef.current = speed;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const engine = engineRef.current;
      if (playingRef.current && engine.phase === "racing") {
        const real = (now - last) / 1000;
        const dt = engine.config.dt;
        let steps = Math.min(80, Math.max(0, Math.floor((real * speedRef.current) / dt)));
        while (steps-- > 0 && engine.phase === "racing") engine.step();
        const phase: string = engine.phase;
        if (phase === "finished") {
          setResult(engine.result());
          setPlayingState(false);
        }
        setSnapshot(engine.snapshot());
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const setPlaying = useCallback((b: boolean) => setPlayingState(b), []);
  const setSpeed = useCallback((n: number) => setSpeedState(n), []);

  const requestPit = useCallback((compound: TyreCompound) => {
    engineRef.current.requestPit(heroIdRef.current, compound);
    setSnapshot(engineRef.current.snapshot());
  }, []);

  const cancelPit = useCallback(() => {
    engineRef.current.cancelPit(heroIdRef.current);
    setSnapshot(engineRef.current.snapshot());
  }, []);

  const restart = useCallback(() => {
    seedRef.current = (seedRef.current * 1103515245 + 12345) & 0x7fffffff;
    const next = makeEngine(seedRef.current, heroRef.current);
    engineRef.current = next.engine;
    heroIdRef.current = next.heroId;
    setResult(null);
    setSnapshot(engineRef.current.snapshot());
    setPlayingState(true);
  }, []);

  return {
    snapshot,
    result,
    playing,
    speed,
    heroId: heroIdRef.current,
    setPlaying,
    setSpeed,
    requestPit,
    cancelPit,
    restart,
  };
}
