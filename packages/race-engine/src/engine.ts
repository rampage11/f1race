import { CONFIG } from "./config.js";
import { fatigueFactor, paceSpeedMultiplier, passProbability, computeStartOutcome } from "./formula.js";
import { mulberry32, type Rng } from "./rng.js";
import { freshTyre, gripFor, wearDeltaForLap } from "./tyres.js";
import { overtakingScoreAround, segmentAtS, trackLengthKm, trackLengthM } from "./track.js";
import type {
  CarSnapshot,
  CarState,
  Driver,
  RaceConfig,
  RaceEvent,
  RaceResult,
  RaceResultRow,
  RaceSnapshot,
  TyreCompound,
} from "./types.js";

const PUSH_BALANCED = 1.0;

export interface EngineOptions {
  dt?: number;
}

export class RaceEngine {
  readonly config: RaceConfig;
  readonly cars: CarState[];
  readonly rng: Rng;
  readonly length: number;
  readonly t0: number;
  readonly lapLengthKm: number;
  time = 0;
  phase: "grid" | "racing" | "finished" = "grid";
  fastestLapDriverId: string | null = null;
  private fastestLapTime = Number.POSITIVE_INFINITY;
  private events: RaceEvent[] = [];
  private readonly dt: number;
  private readonly pitRequests = new Map<string, TyreCompound>();

  constructor(config: RaceConfig, opts: EngineOptions = {}) {
    this.config = config;
    this.rng = mulberry32(config.seed);
    this.length = trackLengthM(config.track);
    this.lapLengthKm = trackLengthKm(config.track);
    this.t0 = this.computeT0();
    this.dt = opts.dt ?? config.dt ?? CONFIG.physics.dtDefault;
    this.cars = this.buildCars();
    this.phase = "racing";
    this.pushEvent({ t: 0, type: "race_start" });
  }

  private computeT0(): number {
    const raw = this.config.track.segments.reduce((t, seg) => t + seg.length / seg.targetSpeed, 0);
    return raw * CONFIG.physics.brakingOverhead;
  }

  private buildCars(): CarState[] {
    const spacing = CONFIG.physics.gridSpacingM;
    return this.config.drivers.map((driver, index) => {
      const gridPosition = index + 1;
      const initialS = -(gridPosition - 1) * spacing;
      const start = computeStartOutcome(driver.reactionTimeSec, driver.skills.reaction);
      const car: CarState = {
        driverId: driver.id,
        gridPosition,
        initialS,
        s: initialS,
        v: 0,
        lap: 0,
        lapStartTime: 0,
        lastLapTime: null,
        bestLapTime: null,
        raceTime: 0,
        tyre: freshTyre(driver.startingTyre),
        tyreStops: 0,
        position: gridPosition,
        inPits: false,
        pitTimer: 0,
        pendingTyre: null,
        pitLaneTimeTotal: 0,
        finished: false,
        finishTime: null,
        finishPlace: null,
        dnf: false,
        fatigue: 0,
        penaltySec: start.falseStart ? start.latePenaltySec : 0,
        overtakeScore: 0,
        defendScore: 0,
        battleCooldown: 0,
        falseStart: start.falseStart,
        effectiveGoDelay: start.effectiveGoDelay,
        bonusAccel: start.bonusAccel,
        pushLevel: PUSH_BALANCED,
        noiseFactor: 0,
        noiseTimer: 0,
        trainSize: 0,
      };
      if (start.falseStart) {
        this.pushEvent({ t: 0, type: "false_start", driverId: driver.id });
      }
      return car;
    });
  }

  private pushEvent(e: RaceEvent): void {
    this.events.push(e);
  }

  private driverOf(car: CarState): Driver {
    const d = this.config.drivers.find((x) => x.id === car.driverId);
    if (!d) throw new Error(`driver not found: ${car.driverId}`);
    return d;
  }

  step(dt: number = this.dt): void {
    if (this.phase !== "racing") return;
    this.time += dt;
    for (const car of this.cars) this.stepCar(car, dt);
    this.handlePits(dt);
    this.updatePositionsAndTrains();
    this.handleBattles(dt);
    if (this.allFinished()) this.finishRace();
  }

  run(maxSeconds = 60_000): RaceResult {
    let guard = 0;
    const maxSteps = Math.ceil(maxSeconds / this.dt);
    while (this.phase === "racing" && guard < maxSteps) {
      this.step();
      guard++;
    }
    if (guard >= maxSteps && this.phase !== "finished") {
      this.finishRace(true);
    }
    return this.result();
  }

  requestPit(driverId: string, compound: TyreCompound): void {
    this.pitRequests.set(driverId, compound);
  }

  cancelPit(driverId: string): void {
    this.pitRequests.delete(driverId);
  }

  hasPendingPit(driverId: string): boolean {
    return this.pitRequests.has(driverId);
  }

  private stepCar(car: CarState, dt: number): void {
    if (car.finished || car.dnf) return;
    if (car.inPits) return;
    const driver = this.driverOf(car);

    if (this.time < car.effectiveGoDelay) {
      car.v = 0;
      return;
    }

    const sNorm = ((car.s % this.length) + this.length) % this.length;
    const seg = segmentAtS(this.config.track, sNorm);
    this.updateNoise(car, dt);

    const fatigue01 = fatigueFactor(Math.max(0, car.lap), this.config.totalLaps);
    car.fatigue = fatigue01;

    const vTarget = seg.targetSpeed * paceSpeedMultiplier({
      paceSkill: driver.skills.pace,
      fitnessSkill: driver.skills.fitness,
      fatigue01,
      pushLevel: this.effectivePushLevel(car),
      tyre: car.tyre,
      t0: this.t0,
      noise: car.noiseFactor,
    });

    const accelLimit = CONFIG.physics.maxAccel + (car.bonusAccel > 0 && this.time - car.effectiveGoDelay < 3 ? car.bonusAccel : 0);
    if (car.v < vTarget) {
      car.v = Math.min(vTarget, car.v + accelLimit * dt);
    } else {
      car.v = Math.max(vTarget, car.v - CONFIG.physics.maxBrake * dt);
    }
    car.v = Math.max(0, car.v);

    car.s += car.v * dt;
    car.raceTime += dt;

    const distPerLap = this.length;
    const newLap = Math.floor(Math.max(0, car.s - car.initialS) / distPerLap);
    if (newLap > car.lap) {
      const lapsCompleted = newLap - car.lap;
      for (let i = 0; i < lapsCompleted; i++) {
        const completingLap = car.lap + 1;
        const lapTime = car.raceTime - car.lapStartTime;
        car.lastLapTime = lapTime;
        if (lapTime < this.fastestLapTime && completingLap <= this.config.totalLaps) {
          this.fastestLapTime = lapTime;
          this.fastestLapDriverId = car.driverId;
          this.pushEvent({ t: this.time, type: "fastest_lap", driverId: car.driverId, lapTime });
        }
        car.bestLapTime = car.bestLapTime == null ? lapTime : Math.min(car.bestLapTime, lapTime);
        car.lap = completingLap;
        car.lapStartTime = car.raceTime;
        car.tyre.ageLaps += 1;
        const wear = wearDeltaForLap(car.tyre, this.lapLengthKm, driver.skills.tyreMgmt);
        car.tyre.wear = Math.min(1, car.tyre.wear + wear);
        if (car.lap >= this.config.totalLaps + 1) {
          this.finishCar(car);
          return;
        }
      }
    }

    this.tryAutoPit(car);
  }

  private effectivePushLevel(car: CarState): number {
    return car.pushLevel;
  }

  private updateNoise(car: CarState, dt: number): void {
    car.noiseTimer -= dt;
    if (car.noiseTimer <= 0) {
      car.noiseFactor = this.rng.gauss(0, CONFIG.pace.noiseSigma);
      car.noiseTimer = this.rng.range(1.5, 3.0);
    }
  }

  private tryAutoPit(car: CarState): void {
    if (car.inPits || car.finished) return;
    const driver = this.driverOf(car);
    const plan = driver.pitPlan;
    const requested = this.pitRequests.get(car.driverId);

    let want = false;
    let compound: TyreCompound = plan.compound;

    if (requested) {
      want = true;
      compound = requested;
    } else if (driver.kind === "human") {
      const lapsLeft = this.config.totalLaps - car.lap;
      const dead = car.tyre.wear >= 0.97;
      if (car.tyreStops === 0 && (lapsLeft <= 0 || dead)) want = true;
    } else {
      if (car.tyreStops >= Math.max(1, plan.targetStops)) return;
      if (plan.strategy === "fixed_lap" && plan.lap != null) {
        want = car.lap >= plan.lap;
      } else {
        const cliff = CONFIG.tyres[car.tyre.compound].cliff;
        want = car.tyre.wear >= cliff * 0.92;
        const lapsLeft = this.config.totalLaps - car.lap;
        if (lapsLeft <= 1 && car.tyreStops === 0) want = true;
      }
    }
    if (!want) return;

    const sNorm = ((car.s % this.length) + this.length) % this.length;
    const nearEntry = Math.abs(sNorm - this.config.track.pitEntryS) < CONFIG.pit.pitEntryWindowM;
    if (!nearEntry) return;

    car.inPits = true;
    car.pitTimer = this.config.track.pitLaneDelta;
    car.pendingTyre = compound;
    car.v = 0;
  }

  private handlePits(dt: number): void {
    for (const car of this.cars) {
      if (!car.inPits || car.finished) continue;
      car.pitTimer -= dt;
      car.raceTime += dt;
      car.pitLaneTimeTotal += dt;
      if (car.pitTimer <= this.config.track.pitLaneDelta - this.config.track.pitStopDuration && car.pendingTyre) {
        car.tyre = freshTyre(car.pendingTyre);
        this.pushEvent({
          t: this.time,
          type: "pit_stop",
          driverId: car.driverId,
          compound: car.pendingTyre,
          lap: car.lap,
        });
        car.pendingTyre = null;
        car.tyreStops += 1;
      }
      if (car.pitTimer <= 0) {
        car.inPits = false;
        car.pitTimer = 0;
        car.v = CONFIG.physics.pitApproachSpeed;
        this.pitRequests.delete(car.driverId);
      }
    }
  }

  private updatePositionsAndTrains(): void {
    const active = this.cars.filter((c) => !c.dnf);
    const ranked = [...active].sort((a, b) => this.compareOnTrack(a, b));
    ranked.forEach((c, i) => (c.position = i + 1));

    for (const car of ranked) {
      let train = 0;
      for (const other of ranked) {
        if (other === car) continue;
        const gapSec = this.gapBetweenSec(other, car);
        if (gapSec > 0 && gapSec < CONFIG.battle.closeGapSec) train++;
      }
      car.trainSize = train;
    }
  }

  private compareOnTrack(a: CarState, b: CarState): number {
    if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) {
      const ta = a.finishTime ?? Number.POSITIVE_INFINITY;
      const tb = b.finishTime ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
    }
    const da = a.s - a.initialS;
    const db = b.s - b.initialS;
    if (da !== db) return db - da;
    return a.raceTime - b.raceTime;
  }

  private distTravelled(c: CarState): number {
    return c.s - c.initialS;
  }

  gapBetweenSec(ahead: CarState, behind: CarState): number {
    const distAhead = this.distTravelled(ahead);
    const distBehind = this.distTravelled(behind);
    const deltaM = distAhead - distBehind;
    if (deltaM <= 0) return 0;
    const vRef = Math.max(20, behind.v);
    return deltaM / vRef;
  }

  private handleBattles(dt: number): void {
    for (const car of this.cars) {
      car.battleCooldown = Math.max(0, car.battleCooldown - dt);
    }
    const ranked = [...this.cars]
      .filter((c) => !c.finished && !c.dnf && !c.inPits)
      .sort((a, b) => this.compareOnTrack(a, b));
    for (let i = 0; i < ranked.length - 1; i++) {
      const behind = ranked[i + 1]!;
      const ahead = ranked[i]!;
      const gap = this.gapBetweenSec(ahead, behind);
      if (gap > CONFIG.battle.attackGapSec) continue;
      if (behind.battleCooldown > 0) continue;
      if (behind.v <= ahead.v + 0.05) {
        behind.battleCooldown = CONFIG.battle.attackCooldownSec * 0.35;
        continue;
      }
      this.attemptOvertake(ahead, behind);
    }
  }

  private attemptOvertake(ahead: CarState, behind: CarState): void {
    const b = CONFIG.battle;
    const behindDriver = this.driverOf(behind);
    const aheadDriver = this.driverOf(ahead);
    const sNorm = ((behind.s % this.length) + this.length) % this.length;
    const ov = overtakingScoreAround(this.config.track, sNorm);
    if (ov < 0.25) {
      behind.battleCooldown = b.attackCooldownSec * 0.5;
      return;
    }
    const paceDeltaMs = behind.v - ahead.v;
    const tyreAdv = gripFor(behind.tyre) - gripFor(ahead.tyre);
    const p = passProbability({
      paceDeltaMs,
      attackSkill: behindDriver.skills.attack,
      defenseSkill: aheadDriver.skills.defense,
      tyreAdvantage: tyreAdv,
      trainSize: behind.trainSize,
      overtakingScore: ov,
      attackerAlreadyAhead: false,
    });
    behind.battleCooldown = b.attackCooldownSec;
    if (this.rng.bool(p)) {
      const swap = ahead.s + 0.5;
      behind.s = swap;
      behind.overtakeScore += 1;
      ahead.defendScore += 1;
      this.pushEvent({
        t: this.time,
        type: "overtake",
        attackerId: behind.driverId,
        victimId: ahead.driverId,
        lap: behind.lap,
      });
    }
  }

  private finishCar(car: CarState): void {
    if (car.finished) return;
    car.finished = true;
    car.finishTime = car.raceTime;
    car.v = 0;
  }

  private allFinished(): boolean {
    return this.cars.every((c) => c.finished || c.dnf);
  }

  private finishRace(timeout = false): void {
    this.phase = "finished";
    if (timeout) {
      for (const c of this.cars) if (!c.finished && !c.dnf) this.finishCar(c);
    }
    const ranked = [...this.cars].sort((a, b) => this.compareOnTrack(a, b));
    ranked.forEach((c, i) => {
      c.finishPlace = i + 1;
      this.pushEvent({ t: this.time, type: "finish", driverId: c.driverId, place: i + 1 });
    });
  }

  result(): RaceResult {
    const ranked = [...this.cars].sort((a, b) => this.compareOnTrack(a, b));
    const leaderTime = ranked.find((c) => !c.dnf)?.raceTime ?? 0;
    const rows: RaceResultRow[] = ranked.map((c, i) => ({
      driverId: c.driverId,
      place: c.finishPlace ?? i + 1,
      raceTime: c.raceTime + c.penaltySec,
      bestLapTime: c.bestLapTime,
      gapToLeader: Math.max(0, c.raceTime - leaderTime),
      tyreStops: c.tyreStops,
      fastestLap: this.fastestLapDriverId === c.driverId,
      positionsGained: Math.max(0, c.gridPosition - (c.finishPlace ?? i + 1)),
      gridPosition: c.gridPosition,
      dnf: c.dnf,
    }));
    return { rows, fastestLapDriverId: this.fastestLapDriverId, events: this.events };
  }

  snapshot(): RaceSnapshot {
    const ranked = [...this.cars].sort((a, b) => this.compareOnTrack(a, b));
    let prevAhead: CarState | null = null;
    const cars: CarSnapshot[] = ranked.map((c, i) => {
      const driver = this.driverOf(c);
      const sNorm = ((c.s % this.length) + this.length) % this.length;
      const gapAhead = prevAhead && !prevAhead.finished ? this.gapBetweenSec(prevAhead, c) : 0;
      prevAhead = c;
      return {
        driverId: c.driverId,
        name: driver.name,
        team: driver.team,
        country: driver.country,
        kind: driver.kind,
        position: i + 1,
        gridPosition: c.gridPosition,
        lap: Math.max(0, c.lap),
        sFraction: sNorm / this.length,
        v: c.v,
        tyreCompound: c.tyre.compound,
        tyreWear: c.tyre.wear,
        inPits: c.inPits,
        pitTimer: Math.max(0, c.pitTimer),
        finished: c.finished,
        dnf: c.dnf,
        raceTime: c.raceTime,
        gapAhead,
        pitPending: this.pitRequests.has(c.driverId),
        falseStart: c.falseStart,
        overtakeScore: c.overtakeScore,
      };
    });
    return {
      time: this.time,
      phase: this.phase,
      totalLaps: this.config.totalLaps,
      trackLengthM: this.length,
      cars,
      fastestLapDriverId: this.fastestLapDriverId,
      events: this.events,
      heroId: this.config.heroId ?? null,
    };
  }
}
