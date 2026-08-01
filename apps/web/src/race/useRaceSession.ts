import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PilotProfile,
  QualyPhase,
  QualyResultRow,
  QualySnapshot,
  RaceResult,
  RaceSnapshot,
  TyreCompound,
} from "@f1race/race-engine";

export type Stage = "qualy" | "race" | "finished";

export interface SessionCar {
  driverId: string;
  name: string;
  team: string;
  country: string;
  kind: "human" | "bot";
  sFraction: number;
  v: number;
  inPits: boolean;
  finished: boolean;
  position: number | null;
  tyreCompound?: TyreCompound;
  tyreWear?: number;
  lap?: number;
  pitPending?: boolean;
  pitTimer?: number;
  blueFlag?: boolean;
  lateral?: number;
  overtakeScore?: number;
  bestLapTime?: number | null;
  gapAhead?: number;
  phase?: QualyPhase;
  gridPosition?: number | null;
}

export interface SessionSnapshot {
  stage: Stage;
  time: number;
  totalLaps?: number;
  heroId: string;
  cars: SessionCar[];
  qualyResults?: QualyResultRow[];
}

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787";

function fromQualy(snap: QualySnapshot, heroId: string): SessionSnapshot {
  return {
    stage: "qualy",
    time: snap.time,
    heroId,
    cars: snap.cars.map((c) => ({
      driverId: c.driverId,
      name: c.name,
      team: c.team,
      country: c.country,
      kind: c.kind,
      sFraction: c.sFraction,
      v: c.v,
      inPits: c.inPits,
      finished: c.phase === "done",
      position: c.gridPosition ?? null,
      bestLapTime: c.bestLapTime,
      phase: c.phase,
      lateral: 0,
    })),
    qualyResults: snap.results,
  };
}

function fromRace(snap: RaceSnapshot, heroId: string): SessionSnapshot {
  return {
    stage: "race",
    time: snap.time,
    totalLaps: snap.totalLaps,
    heroId,
    cars: snap.cars.map((c) => ({
      driverId: c.driverId,
      name: c.name,
      team: c.team,
      country: c.country,
      kind: c.kind,
      sFraction: c.sFraction,
      v: c.v,
      inPits: c.inPits,
      finished: c.finished,
      position: c.position,
      tyreCompound: c.tyreCompound,
      tyreWear: c.tyreWear,
      lap: c.lap,
      pitPending: c.pitPending,
      pitTimer: c.pitTimer,
      blueFlag: c.blueFlag,
      lateral: c.lateral,
      overtakeScore: c.overtakeScore,
      gapAhead: c.gapAhead,
      gridPosition: c.gridPosition,
    })),
  };
}

export interface SessionControls {
  connected: boolean;
  stage: Stage;
  snapshot: SessionSnapshot | null;
  result: RaceResult | null;
  heroId: string;
  speed: number;
  paused: boolean;
  setSpeed: (n: number) => void;
  setPaused: (b: boolean) => void;
  requestPit: (compound: TyreCompound) => void;
  restart: () => void;
}

export function useRaceSession(hero: PilotProfile): SessionControls {
  const [connected, setConnected] = useState(false);
  const [stage, setStage] = useState<Stage>("qualy");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [speed, setSpeedState] = useState(6);
  const [paused, setPausedState] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const heroRef = useRef(hero);
  heroRef.current = hero;

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "hello", hero: heroRef.current }));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "stage") {
        setStage(msg.stage as Stage);
      } else if (msg.type === "snapshot") {
        const m = msg as unknown as { stage: Stage; snapshot: QualySnapshot | RaceSnapshot; heroId: string };
        setSnapshot(m.stage === "qualy" ? fromQualy(m.snapshot as QualySnapshot, m.heroId) : fromRace(m.snapshot as RaceSnapshot, m.heroId));
      } else if (msg.type === "result") {
        setResult(msg.result as RaceResult);
      }
    };
    return () => ws.close();
  }, []);

  const setSpeed = useCallback((n: number) => {
    setSpeedState(n);
    send({ type: "speed", value: n });
  }, [send]);

  const setPaused = useCallback((b: boolean) => {
    setPausedState(b);
    send({ type: "pause", paused: b });
  }, [send]);

  const requestPit = useCallback((compound: TyreCompound) => {
    send({ type: "pit", compound });
  }, [send]);

  const restart = useCallback(() => {
    setResult(null);
    setStage("qualy");
    send({ type: "restart" });
  }, [send]);

  const heroId = useMemo(() => snapshot?.heroId ?? "", [snapshot]);

  return {
    connected,
    stage,
    snapshot,
    result,
    heroId,
    speed,
    paused,
    setSpeed,
    setPaused,
    requestPit,
    restart,
  };
}
