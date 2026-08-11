import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HammerMode,
  PilotProfile,
  PushStrategy,
  QualyPhase,
  QualyResultRow,
  QualySnapshot,
  RaceEvent,
  RaceResult,
  RaceSnapshot,
  StartCategory,
  TimeOfDay,
  TyreCompound,
  Weather,
} from "@f1race/race-engine";
import { writeCachedProfile, getAuthToken, setAuthProfile } from "../identity";
import type { Division, DriverProfileSummary } from "../identity";

export type Stage = "qualy" | "startSequence" | "race" | "finished";
export type RoomMode = "solo" | "multiplayer";
export type ConnectionState = "connected" | "reconnecting" | "disconnected";

export interface RoomPlayer {
  driverId: string;
  name: string;
  connected: boolean;
}

export interface SessionError {
  id: number;
  message: string;
  at: number;
}

export interface StartSequence {
  lightsOutAt: number;
  sequenceId: number;
}

export interface MyStartResult {
  reactionSec: number;
  jumpStart: boolean;
  category?: StartCategory;
}

export interface SessionForecast {
  trackId?: string;
  trackName?: string;
  trackCountry?: string;
  lengthM?: number;
  laps?: number;
  weather?: Weather;
  timeOfDay?: TimeOfDay;
}

export interface LobbyState {
  division: Division;
  queuedPlayers: number;
  estimatedWaitSec: number;
}

export interface RaceProgression {
  xpGained: number;
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  division: Division;
  racesCount: number;
  leveledUp: boolean;
}

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
  lastLapTime?: number | null;
  bestLapTime?: number | null;
  gapAhead?: number;
  phase?: QualyPhase;
  gridPosition?: number | null;
  hammerTime?: { active: boolean; mode: HammerMode | null; remainingSec: number; cooldownSec: number; readyAt: number };
  drsActive?: boolean;
  tow?: boolean;
  pushStrategy?: PushStrategy;
}

export interface SessionSnapshot {
  stage: Stage;
  time: number;
  totalLaps?: number;
  heroId: string;
  cars: SessionCar[];
  qualyResults?: QualyResultRow[];
  weather?: Weather;
  effectiveWeather?: Weather;
  timeOfDay?: TimeOfDay;
  trackId?: string;
  trackName?: string;
  trackCountry?: string;
  events?: RaceEvent[];
  latestEventSeq?: number;
}

export const ERROR_TEXT: Record<string, string> = {
  "rate limit: speed": "Слишком частая смена скорости",
  "rate limit: pause": "Слишком частое переключение паузы",
  "rate limit: pit": "Слишком частый запрос пит-стопа",
  "rate limit: cancelPit": "Слишком частая отмена пит-стопа",
  "rate limit: restart": "Подождите перед рестартом",
  "rate limit: setStartingTyre": "Слишком частая смена резины",
  "rate limit: setPushLevel": "Слишком частая смена стратегии",
  "rate limit: hammerTime": "Слишком частый запрос Hammer Time",
  "rate limit: startReaction": "Слишком частый запрос старта",
  "pit only available during the race": "Пит-стоп доступен только во время гонки",
  "push level only available during the race": "Стратегия доступна только во время гонки",
  "invalid push strategy": "Недопустимая стратегия",
  "already on that tyre compound": "Этот состав уже стоит — нужна смена (правило Ф1)",
  "unknown driver": "Вашего пилота нет в этой гонке",
  "invalid or expired session token": "Сессия истекла — переподключение новым входом",
  "invalid json": "Сервер не понял команду",
  "tyre can only be chosen before the race": "Резину можно выбрать только до гонки",
  "invalid tyre compound": "Недопустимый состав резины",
};

export function friendlyError(message: string): string {
  return ERROR_TEXT[message] ?? message;
}

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787";
const PROTOCOL_VERSION = 1;
const TOKEN_KEY = "f1race.sessionToken";
const ERROR_TTL_MS = 4000;
const MAX_RECONNECT_ATTEMPTS = 8;

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

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
    weather: snap.weather,
    effectiveWeather: snap.effectiveWeather,
    timeOfDay: snap.timeOfDay,
    trackId: snap.trackId,
    trackName: snap.trackName,
    trackCountry: snap.trackCountry,
    events: snap.events,
    latestEventSeq: snap.eventSeq,
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
      lastLapTime: c.lastLapTime,
      bestLapTime: c.bestLapTime,
      gapAhead: c.gapAhead,
      gridPosition: c.gridPosition,
      hammerTime: c.hammerTime,
      drsActive: c.drsActive,
      tow: c.tow,
      pushStrategy: c.pushStrategy,
    })),
  };
}

export interface SessionControls {
  connected: boolean;
  connectionState: ConnectionState;
  reconnecting: boolean;
  inLobby: boolean;
  lobby: LobbyState | null;
  stage: Stage;
  snapshot: SessionSnapshot | null;
  result: RaceResult | null;
  heroId: string;
  driverId: string;
  mode: RoomMode;
  players: RoomPlayer[];
  errors: SessionError[];
  speed: number;
  paused: boolean;
  startSequence: StartSequence | null;
  myStartResult: MyStartResult | null;
  reacted: boolean;
  profile: DriverProfileSummary | null;
  lastProgression: RaceProgression | null;
  forecast: SessionForecast | null;
  tutorialStep: { step: string; title?: string; text?: string; highlight?: "pit" | "hammer" | null } | null;
  setSpeed: (n: number) => void;
  setPaused: (b: boolean) => void;
  requestPit: (compound: TyreCompound) => void;
  cancelPit: () => void;
  restart: () => void;
  sendStartReaction: () => void;
  requestHammer: (mode: HammerMode) => void;
  setStartingTyre: (compound: TyreCompound) => void;
  setPushLevel: (strategy: PushStrategy) => void;
}

export function useRaceSession(hero: PilotProfile, guestId: string, connMode: "race" | "tutorial" = "race"): SessionControls {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [stage, setStage] = useState<Stage>("qualy");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [result, setResult] = useState<RaceResult | null>(null);
  const [speed, setSpeedState] = useState(6);
  const [paused, setPausedState] = useState(false);
  const [mode, setMode] = useState<RoomMode>("solo");
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [driverId, setDriverId] = useState("");
  const [errors, setErrors] = useState<SessionError[]>([]);
  const [startSequence, setStartSequence] = useState<StartSequence | null>(null);
  const [myStartResult, setMyStartResult] = useState<MyStartResult | null>(null);
  const [reactedSequenceId, setReactedSequenceId] = useState<number | null>(null);
  const [profile, setProfile] = useState<DriverProfileSummary | null>(null);
  const [lastProgression, setLastProgression] = useState<RaceProgression | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [lobbyWaiting, setLobbyWaiting] = useState(false);
  const [forecast, setForecast] = useState<SessionForecast | null>(null);
  const [tutorialStep, setTutorialStep] = useState<SessionControls["tutorialStep"]>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heroRef = useRef(hero);
  heroRef.current = hero;
  const tokenRef = useRef<string | null>(readStoredToken());
  const pendingReconnectRef = useRef(false);
  const errorIdRef = useRef(0);
  const driverIdRef = useRef("");
  driverIdRef.current = driverId;
  const startSequenceRef = useRef<StartSequence | null>(null);
  startSequenceRef.current = startSequence;
  const reactedSeqIdRef = useRef<number | null>(null);
  reactedSeqIdRef.current = reactedSequenceId;
  const profileRef = useRef<DriverProfileSummary | null>(null);
  profileRef.current = profile;
  const guestIdRef = useRef(guestId);
  guestIdRef.current = guestId;
  const lobbyWaitingRef = useRef(false);

  const pushError = useCallback((rawMessage: string) => {
    const id = ++errorIdRef.current;
    const message = friendlyError(rawMessage);
    setErrors((prev) => [...prev.slice(-2), { id, message, at: Date.now() }]);
    setTimeout(() => {
      setErrors((prev) => prev.filter((e) => e.id !== id));
    }, ERROR_TTL_MS);
  }, []);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let manualClose = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const storeToken = (token: string) => {
      tokenRef.current = token;
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* sessionStorage unavailable */
      }
    };
    const clearToken = () => {
      tokenRef.current = null;
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* sessionStorage unavailable */
      }
    };

    const sendHello = (ws: WebSocket) => {
      lobbyWaitingRef.current = true;
      setLobbyWaiting(true);
      setLobby(null);
      const authToken = getAuthToken();
      const payload: { type: "hello"; protocolVersion: number; hero: PilotProfile; guestId: string; authToken?: string } = {
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        hero: heroRef.current,
        guestId: guestIdRef.current,
      };
      if (authToken) payload.authToken = authToken;
      ws.send(JSON.stringify(payload));
    };
    const sendStartTutorial = (ws: WebSocket) => {
      const authToken = getAuthToken();
      const payload: { type: "startTutorial"; hero: PilotProfile; guestId: string; authToken?: string } = {
        type: "startTutorial",
        hero: heroRef.current,
        guestId: guestIdRef.current,
      };
      if (authToken) payload.authToken = authToken;
      ws.send(JSON.stringify(payload));
    };
    const sendReconnectOrHello = (ws: WebSocket) => {
      // Tutorial is a fresh one-shot session — no reconnect, no lobby. Always (re)send startTutorial.
      if (connMode === "tutorial") {
        sendStartTutorial(ws);
        return;
      }
      const token = tokenRef.current;
      if (!token) {
        sendHello(ws);
        return;
      }
      pendingReconnectRef.current = true;
      lobbyWaitingRef.current = false;
      setLobbyWaiting(false);
      setLobby(null);
      ws.send(JSON.stringify({ type: "reconnect", sessionToken: token }));
    };

    const scheduleReconnect = () => {
      if (manualClose) return;
      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionState("disconnected");
        clearToken();
        return;
      }
      const delay = Math.min(500 * 2 ** attempt, 10000);
      attempt += 1;
      setConnectionState("reconnecting");
      reconnectTimer = setTimeout(() => {
        if (manualClose) return;
        try {
          const ws = new WebSocket(WS_URL);
          wsRef.current = ws;
          attach(ws);
        } catch {
          scheduleReconnect();
        }
      }, delay);
    };

    const attach = (ws: WebSocket) => {
      ws.onopen = () => {
        setConnectionState("connected");
        sendReconnectOrHello(ws);
      };
      ws.onclose = () => {
        if (manualClose) return;
        scheduleReconnect();
      };
      ws.onerror = () => {
        /* browser will fire onclose next */
      };
      ws.onmessage = (ev) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (msg.type) {
          case "tutorialStep": {
            const m = msg as unknown as { step: string; title?: string; text?: string; highlight?: "pit" | "hammer" | null };
            setTutorialStep({ step: m.step, title: m.title, text: m.text, highlight: m.highlight });
            break;
          }
          case "lobbyState": {
            if (!lobbyWaitingRef.current) break;
            const m = msg as unknown as { division: Division; queuedPlayers: number; estimatedWaitSec: number };
            setLobby({ division: m.division, queuedPlayers: m.queuedPlayers, estimatedWaitSec: m.estimatedWaitSec });
            break;
          }
          case "welcome": {
            const m = msg as unknown as {
              driverId: string; sessionToken: string; mode: RoomMode; profile?: DriverProfileSummary;
              track?: { id: string; name: string; country: string; lengthM: number; laps: number };
              weather?: Weather; timeOfDay?: TimeOfDay;
            };
            pendingReconnectRef.current = false;
            lobbyWaitingRef.current = false;
            setLobbyWaiting(false);
            setLobby(null);
            attempt = 0;
            setDriverId(m.driverId);
            setMode(m.mode);
            storeToken(m.sessionToken);
            if (m.track || m.weather || m.timeOfDay) {
              setForecast({
                trackId: m.track?.id,
                trackName: m.track?.name,
                trackCountry: m.track?.country,
                lengthM: m.track?.lengthM,
                laps: m.track?.laps,
                weather: m.weather,
                timeOfDay: m.timeOfDay,
              });
            }
            if (m.profile) {
              setProfile(m.profile);
              writeCachedProfile(m.profile);
              if (getAuthToken()) setAuthProfile(m.profile);
            }
            break;
          }
          case "stage": {
            const newStage = msg.stage as Stage;
            setStage(newStage);
            if (newStage !== "finished") setLastProgression(null);
            setStartSequence(null);
            setMyStartResult(null);
            setReactedSequenceId(null);
            break;
          }
          case "snapshot": {
            const m = msg as unknown as { stage: Stage; snapshot: QualySnapshot | RaceSnapshot; heroId: string };
            setSnapshot(
              m.stage === "qualy"
                ? fromQualy(m.snapshot as QualySnapshot, m.heroId)
                : fromRace(m.snapshot as RaceSnapshot, m.heroId),
            );
            break;
          }
          case "result": {
            setResult(msg.result as RaceResult);
            break;
          }
          case "roomState": {
            const m = msg as unknown as { players: RoomPlayer[]; mode: RoomMode };
            setPlayers(m.players);
            setMode(m.mode);
            break;
          }
          case "startSequence": {
            const m = msg as unknown as { lightsOutAt: number; sequenceId: number };
            setStartSequence({ lightsOutAt: m.lightsOutAt, sequenceId: m.sequenceId });
            setMyStartResult(null);
            setReactedSequenceId(null);
            break;
          }
          case "startResult": {
            const m = msg as unknown as { driverId: string; reactionSec: number; jumpStart: boolean; category?: StartCategory };
            if (m.driverId === driverIdRef.current) {
              setMyStartResult({ reactionSec: m.reactionSec, jumpStart: m.jumpStart, category: m.category });
            }
            break;
          }
          case "progression": {
            const m = msg as unknown as {
              xpGained: number; totalXp: number; level: number;
              xpIntoLevel: number; xpForNext: number; division: Division; racesCount: number;
            };
            const prevLevel = profileRef.current?.level ?? 0;
            setLastProgression({ ...m, leveledUp: m.level > prevLevel });
            if (profileRef.current) {
              const updated: DriverProfileSummary = {
                ...profileRef.current,
                level: m.level,
                division: m.division,
                totalXp: m.totalXp,
                racesCount: m.racesCount,
              };
              setProfile(updated);
              writeCachedProfile(updated);
              if (getAuthToken()) setAuthProfile(updated);
            }
            break;
          }
          case "error": {
            const m = msg as unknown as { message: string };
            if (pendingReconnectRef.current) {
              pendingReconnectRef.current = false;
              clearToken();
              sendHello(ws);
            } else {
              pushError(m.message);
            }
            break;
          }
        }
      };
    };

    try {
      const initial = new WebSocket(WS_URL);
      wsRef.current = initial;
      attach(initial);
    } catch {
      scheduleReconnect();
    }

    return () => {
      manualClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const cur = wsRef.current;
      if (cur) cur.close();
    };
  }, [pushError]);

  const prevModeRef = useRef<RoomMode>("solo");
  useEffect(() => {
    if (prevModeRef.current !== "multiplayer" && mode === "multiplayer") {
      setSpeedState(1);
      setPausedState(false);
    }
    prevModeRef.current = mode;
  }, [mode]);

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

  const cancelPit = useCallback(() => {
    send({ type: "cancelPit" });
  }, [send]);

  const restart = useCallback(() => {
    setResult(null);
    setStage("qualy");
    setStartSequence(null);
    setMyStartResult(null);
    setReactedSequenceId(null);
    setLastProgression(null);
    send({ type: "restart" });
  }, [send]);

  const sendStartReaction = useCallback(() => {
    const seq = startSequenceRef.current;
    if (!seq) return;
    if (reactedSeqIdRef.current === seq.sequenceId) return;
    reactedSeqIdRef.current = seq.sequenceId;
    setReactedSequenceId(seq.sequenceId);
    send({ type: "startReaction", clientTimestamp: performance.now(), sequenceId: seq.sequenceId });
  }, [send]);

  const requestHammer = useCallback((mode: HammerMode) => {
    send({ type: "hammerTime", mode });
  }, [send]);

  const setStartingTyre = useCallback((compound: TyreCompound) => {
    send({ type: "setStartingTyre", compound });
  }, [send]);

  const setPushLevel = useCallback((strategy: PushStrategy) => {
    send({ type: "setPushLevel", strategy });
  }, [send]);

  const heroId = driverId || snapshot?.heroId || "";
  const reconnecting = connectionState === "reconnecting";
  const reacted = startSequence !== null && reactedSequenceId === startSequence.sequenceId;
  const inLobby = lobbyWaiting;

  return useMemo(
    () => ({
      connected: connectionState === "connected",
      connectionState,
      reconnecting,
      inLobby,
      lobby,
      stage,
      snapshot,
      result,
      heroId,
      driverId,
      mode,
      players,
      errors,
      speed,
      paused,
      startSequence,
      myStartResult,
      reacted,
      profile,
      lastProgression,
      forecast,
      tutorialStep,
      setSpeed,
      setPaused,
      requestPit,
      cancelPit,
      restart,
      sendStartReaction,
      requestHammer,
      setStartingTyre,
      setPushLevel,
    }),
    [
      connectionState,
      reconnecting,
      inLobby,
      lobby,
      stage,
      snapshot,
      result,
      heroId,
      driverId,
      mode,
      players,
      errors,
      speed,
      paused,
      startSequence,
      myStartResult,
      reacted,
      profile,
      lastProgression,
      forecast,
      tutorialStep,
      setSpeed,
      setPaused,
      requestPit,
      cancelPit,
      restart,
      sendStartReaction,
      requestHammer,
      setStartingTyre,
      setPushLevel,
    ],
  );
}
