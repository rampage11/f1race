import {
  QualifyingEngine,
  RaceEngine,
  buildQualyConfig,
  buildRaceConfig,
  makeBot,
  makeDriver,
  mulberry32,
  recommendedLaps,
  redBullRing,
  type Driver,
  type PilotProfile,
  type QualySnapshot,
  type RaceResult,
  type RaceSnapshot,
  type TyreCompound,
} from "@f1race/race-engine";
import type { ServerMessage, Stage } from "./protocol.js";

const TICK_MS = 100;
const DT = 0.1;
const DEFAULT_SPEED = 6;
const BOTS_COUNT = 19;

type SessionListener = (msg: ServerMessage) => void;

export class GameSession {
  private stage: Stage = "qualy";
  private speed = DEFAULT_SPEED;
  private paused = false;
  private seed = 42;
  private hero: PilotProfile;
  private drivers: Driver[];
  private qualy: QualifyingEngine;
  private race: RaceEngine | null = null;
  private result: RaceResult | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listener: SessionListener;

  constructor(hero: PilotProfile, listener: SessionListener) {
    this.hero = hero;
    this.listener = listener;
    this.drivers = this.buildField(this.seed);
    this.qualy = this.makeQualy(this.seed);
    this.start();
    this.emitStage();
    this.emitSnapshot();
  }

  get heroId(): string {
    const hero = this.drivers.find((d) => d.kind === "human");
    return hero?.id ?? this.drivers[0]!.id;
  }

  private buildField(seed: number): Driver[] {
    const rng = mulberry32(seed);
    const heroDriver = makeDriver({
      name: this.hero.name || "Вы",
      country: this.hero.country,
      kind: "human",
      team: this.hero.team,
      skills: this.hero.skills,
      startingTyre: this.hero.startingTyre,
      pitPlan: { targetStops: 1, strategy: "flexible", compound: this.hero.pitCompound },
      reactionTimeSec: 0.2,
    });
    const bots: Driver[] = [];
    for (let i = 0; i < BOTS_COUNT; i++) bots.push(makeBot({}, rng));
    return [heroDriver, ...bots];
  }

  private makeQualy(seed: number): QualifyingEngine {
    return new QualifyingEngine(
      buildQualyConfig({ track: redBullRing(), drivers: this.drivers, seed: seed * 7 + 1, startIntervalSec: 5 }),
    );
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setSpeed(value: number): void {
    this.speed = Math.max(1, Math.min(30, Math.round(value)));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  requestPit(compound: TyreCompound): void {
    if (this.stage === "race" && this.race) this.race.requestPit(this.heroId, compound);
  }

  restart(): void {
    this.stop();
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    this.drivers = this.buildField(this.seed);
    this.qualy = this.makeQualy(this.seed);
    this.race = null;
    this.result = null;
    this.stage = "qualy";
    this.start();
    this.emitStage();
    this.emitSnapshot();
  }

  private tick(): void {
    if (this.paused) return;
    const steps = Math.max(1, Math.round((this.speed * (TICK_MS / 1000)) / DT));
    if (this.stage === "qualy") {
      let n = steps;
      while (n-- > 0 && this.qualy.phase === "running") this.qualy.step(DT);
      if (this.qualy.phase === "finished") this.startRace();
      this.emitSnapshot();
    } else if (this.stage === "race" && this.race) {
      let n = steps;
      while (n-- > 0 && this.race.phase === "racing") this.race.step(DT);
      if (this.race.phase === "finished") this.finishRace();
      this.emitSnapshot();
    }
  }

  private startRace(): void {
    const order = this.qualy.gridOrder();
    const byId = new Map(this.drivers.map((d) => [d.id, d]));
    const grid: Driver[] = [];
    for (const id of order) {
      const d = byId.get(id);
      if (d) grid.push(d);
    }
    if (grid.length === 0) grid.push(...this.drivers);
    const track = redBullRing();
    this.race = new RaceEngine(
      buildRaceConfig({
        track,
        drivers: grid,
        totalLaps: recommendedLaps(track),
        seed: this.seed * 13 + 5,
        dt: DT,
        heroId: this.heroId,
      }),
    );
    this.stage = "race";
    this.emitStage();
  }

  private finishRace(): void {
    this.result = this.race!.result();
    this.stage = "finished";
    this.emitStage();
    this.listener({ type: "result", result: this.result!, heroId: this.heroId });
  }

  private emitStage(): void {
    this.listener({ type: "stage", stage: this.stage });
  }

  private emitSnapshot(): void {
    if (this.stage === "qualy") {
      this.listener({ type: "snapshot", stage: "qualy", snapshot: this.qualy.snapshot(), heroId: this.heroId });
    } else if (this.stage === "race" && this.race) {
      this.listener({ type: "snapshot", stage: "race", snapshot: this.race.snapshot(), heroId: this.heroId });
    }
  }
}
