import { CONFIG } from "./config.js";
import { paceSpeedMultiplier } from "./formula.js";
import { mulberry32, type Rng } from "./rng.js";
import { freshTyre } from "./tyres.js";
import { segmentAtS, trackLengthM } from "./track.js";
import type {
  Driver,
  Track,
  TyreCompound,
  TyreState,
} from "./types.js";

export type QualyPhase = "waiting" | "outlap" | "hotlap" | "inlap" | "done";

export interface QualySegment {
  id: string;
  name: string;
}

export interface QualyCarState {
  driverId: string;
  name: string;
  team: string;
  country: string;
  kind: Driver["kind"];
  paceSkill: number;
  startDelay: number;
  phase: QualyPhase;
  s: number;
  v: number;
  lapsDone: number;
  lapStartTime: number;
  bestLapTime: number | null;
  outLapTime: number | null;
  tyre: TyreState;
  noiseFactor: number;
  noiseTimer: number;
}

export interface QualyCarSnapshot {
  driverId: string;
  name: string;
  team: string;
  country: string;
  kind: Driver["kind"];
  phase: QualyPhase;
  sFraction: number;
  v: number;
  inPits: boolean;
  bestLapTime: number | null;
  gridPosition: number | null;
}

export interface QualyResultRow {
  driverId: string;
  bestLapTime: number | null;
  gridPosition: number;
}

export interface QualySnapshot {
  time: number;
  phase: "running" | "finished";
  segment: QualySegment;
  trackLengthM: number;
  cars: QualyCarSnapshot[];
  results: QualyResultRow[];
}

export interface QualyConfig {
  track: Track;
  drivers: Driver[];
  dt: number;
  seed: number;
  startIntervalSec: number;
  tyre?: TyreCompound;
  segment?: QualySegment;
}

const OUTLAP_PUSH = 0.82;
const HOTLAP_PUSH = 1.0;
const INLAP_PUSH = 0.7;

export class QualifyingEngine {
  readonly track: Track;
  readonly cars: QualyCarState[];
  readonly rng: Rng;
  readonly length: number;
  readonly t0: number;
  time = 0;
  phase: "running" | "finished" = "running";
  readonly segment: QualySegment;
  private readonly dt: number;
  private results: QualyResultRow[] = [];

  constructor(private config: QualyConfig) {
    this.track = config.track;
    this.rng = mulberry32(config.seed);
    this.length = trackLengthM(config.track);
    this.t0 = this.computeT0();
    this.dt = config.dt;
    this.segment = config.segment ?? { id: "Q1", name: "Q1" };
    this.cars = config.drivers.map((d, i) => this.buildCar(d, i));
  }

  private computeT0(): number {
    const raw = this.track.segments.reduce((t, seg) => t + seg.length / seg.targetSpeed, 0);
    return raw * CONFIG.physics.brakingOverhead;
  }

  private buildCar(driver: Driver, index: number): QualyCarState {
    const tyre = freshTyre(this.config.tyre ?? driver.startingTyre);
    return {
      driverId: driver.id,
      name: driver.name,
      team: driver.team,
      country: driver.country,
      kind: driver.kind,
      paceSkill: driver.skills.pace,
      startDelay: index * this.config.startIntervalSec,
      phase: "waiting",
      s: this.track.pitExitS,
      v: 0,
      lapsDone: 0,
      lapStartTime: 0,
      bestLapTime: null,
      outLapTime: null,
      tyre,
      noiseFactor: 0,
      noiseTimer: 0,
    };
  }

  step(dt: number = this.dt): void {
    if (this.phase !== "running") return;
    this.time += dt;
    for (const car of this.cars) this.stepCar(car, dt);
    if (this.cars.every((c) => c.phase === "done")) this.finish();
  }

  run(maxSeconds = 60_000): QualySnapshot {
    let guard = 0;
    const maxSteps = Math.ceil(maxSeconds / this.dt);
    while (this.phase === "running" && guard < maxSteps) {
      this.step();
      guard++;
    }
    if (this.phase !== "finished") this.finish();
    return this.snapshot();
  }

  private stepCar(car: QualyCarState, dt: number): void {
    if (car.phase === "done" || car.phase === "waiting" && this.time < car.startDelay) {
      return;
    }
    if (car.phase === "waiting") {
      car.phase = "outlap";
      car.lapStartTime = this.time;
      car.s = this.track.pitExitS;
      car.v = CONFIG.physics.pitApproachSpeed;
    }

    this.updateNoise(car, dt);
    const sNorm = ((car.s % this.length) + this.length) % this.length;
    const seg = segmentAtS(this.track, sNorm);
    const push = car.phase === "outlap" ? OUTLAP_PUSH : car.phase === "hotlap" ? HOTLAP_PUSH : INLAP_PUSH;
    const vTarget = seg.targetSpeed * paceSpeedMultiplier({
      paceSkill: car.paceSkill,
      fitnessSkill: 10,
      fatigue01: 0,
      pushLevel: push,
      tyre: car.tyre,
      t0: this.t0,
      noise: car.noiseFactor,
    });
    if (car.v < vTarget) car.v = Math.min(vTarget, car.v + CONFIG.physics.maxAccel * dt);
    else car.v = Math.max(vTarget, car.v - CONFIG.physics.maxBrake * dt);
    car.v = Math.max(0, car.v);

    const prev = car.s;
    car.s += car.v * dt;

    const crossedLine = this.didCrossStartFinish(prev, car.s);
    if (crossedLine) {
      const lapTime = this.time - car.lapStartTime;
      if (car.phase === "outlap") {
        car.outLapTime = lapTime;
        car.phase = "hotlap";
      } else if (car.phase === "hotlap") {
        car.bestLapTime = lapTime;
        car.phase = "inlap";
      } else if (car.phase === "inlap") {
        car.phase = "done";
        car.v = 0;
        return;
      }
      car.lapStartTime = this.time;
      car.lapsDone += 1;
    }
  }

  private didCrossStartFinish(prevS: number, curS: number): boolean {
    const p = ((prevS % this.length) + this.length) % this.length;
    const c = ((curS % this.length) + this.length) % this.length;
    return c < p;
  }

  private updateNoise(car: QualyCarState, dt: number): void {
    car.noiseTimer -= dt;
    if (car.noiseTimer <= 0) {
      car.noiseFactor = this.rng.gauss(0, CONFIG.qualifying.noiseSigma);
      car.noiseTimer = this.rng.range(1.5, 3.0);
    }
  }

  private finish(): void {
    this.phase = "finished";
    const sorted = [...this.cars].sort((a, b) => (a.bestLapTime ?? 1e9) - (b.bestLapTime ?? 1e9));
    this.results = sorted.map((c, i) => ({
      driverId: c.driverId,
      bestLapTime: c.bestLapTime,
      gridPosition: i + 1,
    }));
  }

  snapshot(): QualySnapshot {
    const gridOf = (driverId: string): number | null => {
      const r = this.results.find((x) => x.driverId === driverId);
      if (r) return r.gridPosition;
      if (this.phase === "finished") {
        const sorted = [...this.cars].sort((a, b) => (a.bestLapTime ?? 1e9) - (b.bestLapTime ?? 1e9));
        const idx = sorted.findIndex((c) => c.driverId === driverId);
        return idx >= 0 ? idx + 1 : null;
      }
      return null;
    };
    const cars: QualyCarSnapshot[] = this.cars.map((c) => {
      const sNorm = ((c.s % this.length) + this.length) % this.length;
      return {
        driverId: c.driverId,
        name: c.name,
        team: c.team,
        country: c.country,
        kind: c.kind,
        phase: c.phase,
        sFraction: sNorm / this.length,
        v: c.v,
        inPits: c.phase === "waiting" || c.phase === "done",
        bestLapTime: c.bestLapTime,
        gridPosition: gridOf(c.driverId),
      };
    });
    return {
      time: this.time,
      phase: this.phase,
      segment: this.segment,
      trackLengthM: this.length,
      cars,
      results: this.results,
    };
  }

  gridOrder(): string[] {
    if (this.phase !== "finished") this.finish();
    return this.results.map((r) => r.driverId);
  }
}

export function defaultSegments(): QualySegment[] {
  return [{ id: "Q1", name: "Q1" }, { id: "Q2", name: "Q2" }, { id: "Q3", name: "Q3" }];
}

export function buildQualyConfig(args: {
  track: Track;
  drivers: Driver[];
  seed?: number;
  dt?: number;
  startIntervalSec?: number;
  tyre?: TyreCompound;
  segment?: QualySegment;
}): QualyConfig {
  const cfg: QualyConfig = {
    track: args.track,
    drivers: args.drivers,
    dt: args.dt ?? CONFIG.physics.dtDefault,
    seed: args.seed ?? (Date.now() >>> 0),
    startIntervalSec: args.startIntervalSec ?? 5,
  };
  if (args.tyre) cfg.tyre = args.tyre;
  if (args.segment) cfg.segment = args.segment;
  return cfg;
}
