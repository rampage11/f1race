import { CONFIG } from "./config.js";
import { fatigueFactor, paceSpeedMultiplier, passProbability, computeStartOutcome, startCategory } from "./formula.js";
import { mulberry32, type Rng } from "./rng.js";
import { freshTyre, gripFor, wearDeltaForLap, estimateTyreLifespanLaps } from "./tyres.js";
import { overtakingScoreAround, segmentAtS, trackLengthKm, trackLengthM } from "./track.js";
import type {
  CarSnapshot,
  CarState,
  Driver,
  HammerMode,
  RaceConfig,
  RaceEvent,
  RaceResult,
  RaceResultRow,
  RaceSnapshot,
  TimeOfDay,
  TyreCompound,
  Weather,
} from "./types.js";

const PUSH_BALANCED = 1.0;

export interface EngineOptions {
  dt?: number;
  weather?: Weather;
  timeOfDay?: TimeOfDay;
}

export type PitRequestResult =
  | "queued"
  | "rejected_unknown_driver"
  | "rejected_not_racing";

export type HammerRequestResult =
  | "activated"
  | "rejected_cooldown"
  | "rejected_pit"
  | "rejected_first_lap"
  | "rejected_tyre_wear"
  | "rejected_unknown_driver"
  | "rejected_not_racing";

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
  private readonly weather: Weather;
  private readonly timeOfDay: TimeOfDay;
  private readonly failureRng: Rng;

  constructor(config: RaceConfig, opts: EngineOptions = {}) {
    this.config = config;
    this.rng = mulberry32(config.seed);
    this.length = trackLengthM(config.track);
    this.lapLengthKm = trackLengthKm(config.track);
    this.t0 = this.computeT0();
    this.dt = opts.dt ?? config.dt ?? CONFIG.physics.dtDefault;
    this.weather = opts.weather ?? config.weather ?? "dry";
    this.timeOfDay = opts.timeOfDay ?? config.timeOfDay ?? "day";
    this.failureRng = mulberry32((config.seed ^ 0x4d454348) >>> 0);
    this.cars = this.buildCars();
    this.phase = "racing";
    this.pushEvent({ t: 0, type: "race_start" });
  }

  private get effectiveWeather(): Weather {
    if (this.weather !== "variable") return this.weather;
    const switchLap = Math.ceil(this.config.totalLaps / 2);
    let maxLap = 0;
    for (const c of this.cars) if (c.lap > maxLap) maxLap = c.lap;
    return maxLap >= switchLap ? "lightRain" : "dry";
  }

  private hammerActive(car: CarState): boolean {
    return this.time < car.hammerActiveUntil;
  }

  private hammerModeOf(car: CarState): HammerMode | null {
    return this.time < car.hammerActiveUntil ? car.hammerMode : null;
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
      const cat = startCategory(driver.reactionTimeSec, start.falseStart);
      const launchMult =
        cat === "perfect" ? 1.10 : cat === "slow" ? 0.95 : cat === "verySlow" ? 0.90 : 1.0;
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
        blueFlag: false,
        overtakingUntil: 0,
        overtakingTarget: null,
        lateral: 0,
        compoundChanged: false,
        defendingClose: false,
        attackingClose: false,
        hammerActiveUntil: 0,
        hammerReadyAt: 0,
        hammerActiveSecThisLap: 0,
        hammerMode: null,
        drsActiveUntil: 0,
        tow: false,
        launchMult,
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
    this.updateDrsAndTow();
    this.updateBlueFlags();
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

  requestPit(driverId: string, compound: TyreCompound): PitRequestResult {
    if (this.phase !== "racing") return "rejected_not_racing";
    const car = this.cars.find((c) => c.driverId === driverId);
    if (!car) return "rejected_unknown_driver";
    // Same-compound stops are allowed (fresh rubber of the same type is a legit choice, e.g.
    // fresh wets in a long wet race); the F1 "must change compound" rule is intentionally NOT
    // enforced. Only the pit-lane time delta gates the stop.
    this.pitRequests.set(driverId, compound);
    return "queued";
  }

  cancelPit(driverId: string): void {
    this.pitRequests.delete(driverId);
  }

  hasPendingPit(driverId: string): boolean {
    return this.pitRequests.has(driverId);
  }

  requestHammer(driverId: string, mode: HammerMode = "push"): HammerRequestResult {
    if (this.phase !== "racing") return "rejected_not_racing";
    const car = this.cars.find((c) => c.driverId === driverId);
    if (!car) return "rejected_unknown_driver";
    if (car.inPits) return "rejected_pit";
    if (CONFIG.HAMMER_TIME.firstLapLock && car.lap < 2) return "rejected_first_lap";
    if (car.tyre.wear >= CONFIG.HAMMER_TIME.minTyreWearToActivate) return "rejected_tyre_wear";
    if (this.time < car.hammerReadyAt) return "rejected_cooldown";
    car.hammerMode = mode;
    car.hammerActiveUntil = this.time + CONFIG.HAMMER_TIME.durationSec;
    car.hammerReadyAt = this.time + CONFIG.HAMMER_TIME.durationSec + CONFIG.HAMMER_TIME.cooldownSec;
    return "activated";
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
    this.updateNoise(car, dt);

    const fatigue01 = fatigueFactor(Math.max(0, car.lap), this.config.totalLaps);
    car.fatigue = fatigue01;

    if (car.overtakingTarget && this.time >= car.overtakingUntil) {
      const target = this.cars.find((c) => c.driverId === car.overtakingTarget);
      if (!target || this.distTravelled(car) >= this.distTravelled(target) - 1) {
        car.overtakingTarget = null;
      }
    }
    const overtaking = this.time < car.overtakingUntil;
    const targetLateral = overtaking || car.overtakingTarget ? 1 : 0;
    car.lateral += (targetLateral - car.lateral) * Math.min(1, dt * 4.5);

    let pushLevel = this.effectivePushLevel(car);
    if (overtaking) pushLevel *= 1.06;
    if (car.blueFlag) pushLevel *= CONFIG.blueFlag.yieldPaceFactor;
    const paceMult = driver.paceFactor * paceSpeedMultiplier({
      paceSkill: driver.skills.pace,
      fitnessSkill: driver.skills.fitness,
      fatigue01,
      pushLevel,
      tyre: car.tyre,
      t0: this.t0,
      noise: car.noiseFactor,
      weather: this.effectiveWeather,
      towBonusSec: car.tow ? CONFIG.slipstream.paceBonusSec : 0,
    });
    const hammerMode = this.hammerModeOf(car);
    const cornerMult = hammerMode ? CONFIG.HAMMER_TIME.mode[hammerMode].cornering : 1;
    const vTarget = this.lookaheadSpeed(sNorm, paceMult, cornerMult);

    const sinceGo = this.time - car.effectiveGoDelay;
    let launchBoost = sinceGo < 8 ? driver.launchFactor : 1;
    if (sinceGo < 5) launchBoost *= car.launchMult;
    const accelLimit = (CONFIG.physics.maxAccel + (car.bonusAccel > 0 && sinceGo < 3 ? car.bonusAccel : 0)) * launchBoost;
    if (car.v < vTarget) {
      car.v = Math.min(vTarget, car.v + accelLimit * dt);
    } else {
      car.v = Math.max(vTarget, car.v - CONFIG.physics.maxBrake * dt);
    }
    car.v = Math.max(0, car.v);

    car.s += car.v * dt;
    car.raceTime += dt;
    if (this.hammerActive(car)) car.hammerActiveSecThisLap += dt;

    const distPerLap = this.length;
    const newLap = Math.floor(Math.max(0, car.s - car.initialS) / distPerLap);
    if (newLap > car.lap) {
      const lapsCompleted = newLap - car.lap;
      for (let i = 0; i < lapsCompleted; i++) {
        const completingLap = car.lap + 1;
        const lapTime = car.raceTime - car.lapStartTime;
        car.lastLapTime = lapTime;
        const saneLap = lapTime >= this.t0 * 0.4 && lapTime <= this.t0 * 4;
        if (saneLap && lapTime < this.fastestLapTime && completingLap <= this.config.totalLaps) {
          this.fastestLapTime = lapTime;
          this.fastestLapDriverId = car.driverId;
          this.pushEvent({ t: this.time, type: "fastest_lap", driverId: car.driverId, lapTime });
        }
        if (saneLap) {
          car.bestLapTime = car.bestLapTime == null ? lapTime : Math.min(car.bestLapTime, lapTime);
        }
        car.lap = completingLap;
        car.lapStartTime = car.raceTime;
        car.tyre.ageLaps += 1;
        const hammerFrac = lapTime > 0 ? Math.min(1, car.hammerActiveSecThisLap / lapTime) : 0;
        // Use the persisted car.hammerMode (not the step-local one) so a boost that expired
        // mid-lap still taxes tyre wear for the fraction of the lap it was active — the wear
        // cost is earned the moment Hammer Time is used, regardless of when the lap completes.
        const wearMode = hammerFrac > 0 ? car.hammerMode : null;
        const wearBase = wearMode ? CONFIG.HAMMER_TIME.mode[wearMode].tyreWear : 1;
        const wearMult = 1 + hammerFrac * (wearBase - 1);
        const wear = wearDeltaForLap(car.tyre, this.lapLengthKm, driver.skills.tyreMgmt, this.effectiveWeather) * wearMult;
        car.tyre.wear = Math.min(1, car.tyre.wear + wear);
        car.hammerActiveSecThisLap = 0;
        if (completingLap >= CONFIG.mechanicalFailure.minLap && this.failureRng.bool(CONFIG.mechanicalFailure.basePerLap)) {
          car.dnf = true;
          this.pushEvent({ t: this.time, type: "info", message: `${this.driverOf(car).name}: сход (механика)` });
          return;
        }
        if (car.lap >= this.config.totalLaps) {
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

  private lookaheadSpeed(sNorm: number, paceMult: number, cornerMult = 1): number {
    const LOOKAHEAD = 280;
    const STEP = 14;
    const brake = CONFIG.physics.maxBrake;
    let limit = Infinity;
    for (let d = 0; d <= LOOKAHEAD; d += STEP) {
      const s = (sNorm + d) % this.length;
      const seg = segmentAtS(this.config.track, s);
      const segTarget = seg.kind === "corner" ? seg.targetSpeed * cornerMult : seg.targetSpeed;
      const vSeg = segTarget * paceMult;
      const allowed = Math.sqrt(vSeg * vSeg + 2 * brake * d);
      if (allowed < limit) limit = allowed;
    }
    return limit;
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
    const effW = this.effectiveWeather;
    const rainy = effW === "lightRain" || effW === "heavyRain";
    if (rainy) {
      compound = effW === "heavyRain" ? "wet" : "intermediate";
    } else if (compound === car.tyre.compound) {
      const alts = (["soft", "medium", "hard"] as TyreCompound[]).filter((c) => c !== car.tyre.compound);
      compound = alts.includes("medium") ? "medium" : alts[0]!;
    }

    if (requested) {
      want = true;
      compound = requested;
    } else if (driver.kind === "bot") {
      // Only bots auto-pit on strategy/wear. Humans pit ONLY on an explicit player request —
      // the player owns pit timing (if they never stop, the F1 compound-rule DSQ at the finish
      // is the intended consequence, not a silent mid-race auto-pit).
      const cliff = CONFIG.tyres[car.tyre.compound].cliff;
      const wornOut = car.tyre.wear >= cliff * 0.92;
      const lapsLeft = this.config.totalLaps - car.lap;
      const needStop = car.tyreStops < Math.max(1, plan.targetStops);
      const lifespan2 = estimateTyreLifespanLaps(compound, driver.skills.tyreMgmt, this.lapLengthKm);
      const strategicWindow = lapsLeft <= lifespan2 + 1;
      if (needStop && (wornOut || strategicWindow || lapsLeft <= 1)) want = true;
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
        const oldCompound = car.tyre.compound;
        car.tyre = freshTyre(car.pendingTyre);
        if (car.pendingTyre !== oldCompound) car.compoundChanged = true;
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
      const lapsDone = Math.floor((car.s - car.initialS) / this.length);
      if (lapsDone > car.lap) {
        car.lap = lapsDone;
        car.lapStartTime = car.raceTime;
      }
      if (car.pitTimer <= 0) {
        car.inPits = false;
        car.pitTimer = 0;
        const nextLineS = (Math.floor(car.s / this.length) + 1) * this.length;
        car.s = nextLineS + this.config.track.pitExitS;
        car.v = CONFIG.physics.pitApproachSpeed;
        this.pitRequests.delete(car.driverId);
        if (car.s - car.initialS >= this.config.totalLaps * this.length) {
          this.finishCar(car);
        }
      }
    }
  }

  private updatePositionsAndTrains(): void {
    const active = this.cars.filter((c) => !c.dnf);
    const ranked = [...active].sort((a, b) => this.compareOnTrack(a, b));
    ranked.forEach((c, i) => (c.position = i + 1));

    for (const car of ranked) {
      let train = 0;
      let attacking = false;
      let defending = false;
      for (const other of ranked) {
        if (other === car) continue;
        const gAhead = this.gapBetweenSec(other, car);
        const gBehind = this.gapBetweenSec(car, other);
        if (gAhead > 0 && gAhead < CONFIG.battle.closeGapSec) {
          attacking = true;
          train++;
        }
        if (gBehind > 0 && gBehind < CONFIG.battle.closeGapSec) {
          defending = true;
          train++;
        }
      }
      car.trainSize = train;
      car.attackingClose = attacking;
      car.defendingClose = defending;
    }
  }

  private updateDrsAndTow(): void {
    for (const car of this.cars) car.tow = false;
    const active = this.cars.filter((c) => !c.dnf && !c.finished && !c.inPits);
    const ranked = [...active].sort((a, b) => this.compareOnTrack(a, b));
    for (let i = 0; i < ranked.length - 1; i++) {
      const ahead = ranked[i]!;
      const behind = ranked[i + 1]!;
      const sNorm = ((behind.s % this.length) + this.length) % this.length;
      const gap = this.gapBetweenSec(ahead, behind);
      if (gap <= 0) continue;
      const seg = segmentAtS(this.config.track, sNorm);
      const ovOk = seg.overtaking >= CONFIG.slipstream.minOvertakingScore;
      if (gap <= CONFIG.slipstream.gapSec && ovOk) behind.tow = true;
      const inZone = this.config.track.drsZones.some((z) => sNorm >= z.startS && sNorm <= z.endS);
      if (inZone && gap <= CONFIG.battle.drsGapSec && ovOk) {
        behind.drsActiveUntil = this.time + 1.0;
      }
    }
  }

  private updateBlueFlags(): void {
    const len = this.length;
    const fracOf = (s: number) => {
      const n = ((s % len) + len) % len;
      return n / len;
    };
    const bf = CONFIG.blueFlag;
    for (const car of this.cars) {
      car.blueFlag = false;
      if (car.inPits || car.finished || car.dnf) continue;
      const carDist = this.distTravelled(car);
      const carFrac = fracOf(car.s);
      for (const other of this.cars) {
        if (other === car || other.inPits || other.finished || other.dnf) continue;
        const otherDist = this.distTravelled(other);
        if (otherDist < carDist + len) continue;
        const otherFrac = fracOf(other.s);
        let behind = carFrac - otherFrac;
        if (behind < 0) behind += 1;
        const distM = behind * len;
        if (distM <= bf.minDistM || distM >= len) continue;
        const gapSec = distM / Math.max(20, other.v);
        if (gapSec < bf.triggerGapSec) {
          car.blueFlag = true;
          break;
        }
      }
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

  private physicalGapSec(ahead: CarState, behind: CarState): number {
    const len = this.length;
    const sAhead = ((ahead.s % len) + len) % len;
    const sBehind = ((behind.s % len) + len) % len;
    let gapM = sAhead - sBehind;
    if (gapM < 0) gapM += len;
    if (gapM >= len) return 0;
    return gapM / Math.max(20, behind.v);
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
      if (this.time < behind.overtakingUntil) continue;
      if (behind.overtakingTarget) continue;
      const gap = this.gapBetweenSec(ahead, behind);
      if (gap > CONFIG.battle.attackGapSec) continue;
      if (behind.battleCooldown > 0) continue;
      if (behind.v <= ahead.v + 0.05) {
        behind.battleCooldown = CONFIG.battle.attackCooldownSec * 0.35;
        continue;
      }
      this.attemptOvertake(ahead, behind, 0);
    }
    for (const behind of ranked) {
      if (this.time < behind.overtakingUntil) continue;
      if (behind.overtakingTarget) continue;
      if (behind.battleCooldown > 0) continue;
      for (const ahead of ranked) {
        if (ahead === behind) continue;
        const lapDelta = behind.lap - ahead.lap;
        if (lapDelta < 1) continue;
        const gap = this.physicalGapSec(ahead, behind);
        if (gap <= 0 || gap > CONFIG.battle.attackGapSec) continue;
        if (behind.v <= ahead.v + 0.05) continue;
        this.attemptOvertake(ahead, behind, lapDelta);
        if (behind.overtakingTarget) break;
      }
    }
  }

  private attemptOvertake(ahead: CarState, behind: CarState, lapDelta: number): void {
    const b = CONFIG.battle;
    const behindDriver = this.driverOf(behind);
    const sNorm = ((behind.s % this.length) + this.length) % this.length;
    const ov = overtakingScoreAround(this.config.track, sNorm);
    const minOv = lapDelta >= 1 ? CONFIG.blueFlag.minOvertakingScore : 0.25;
    if (ov < minOv) {
      behind.battleCooldown = b.attackCooldownSec * 0.5;
      return;
    }
    const paceDeltaMs = behind.v - ahead.v;
    const tyreAdv = gripFor(behind.tyre, this.effectiveWeather) - gripFor(ahead.tyre, this.effectiveWeather);
    const aheadDriver = this.driverOf(ahead);
    const p = passProbability({
      paceDeltaMs,
      attackSkill: behindDriver.skills.attack,
      defenseSkill: aheadDriver.skills.defense,
      tyreAdvantage: tyreAdv,
      trainSize: behind.trainSize,
      overtakingScore: ov,
      attackerAlreadyAhead: false,
      lapDelta,
      weather: this.effectiveWeather,
      attackerDrsActive: this.time < behind.drsActiveUntil,
      attackerHammerMode: this.hammerModeOf(behind),
      defenderHammerMode: this.hammerModeOf(ahead),
    });
    behind.battleCooldown = b.attackCooldownSec;
    if (this.rng.bool(p)) {
      behind.overtakingUntil = this.time + 5;
      behind.overtakingTarget = ahead.driverId;
      behind.overtakeScore += 1;
      if (lapDelta < 1) ahead.defendScore += 1;
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
    const rows: RaceResultRow[] = ranked.map((c, i) => {
      const noStop = c.tyreStops < 1;
      if (noStop && c.finishPlace == null) {
        this.pushEvent({ t: this.time, type: "info", message: `${this.driverOf(c).name}: дисквалификация — не заехал в боксы` });
      }
      const dsq = noStop;
      // No compound-change penalty: same-compound stops are a legal strategy. Only a total
      // failure to stop is punished (DSQ above).
      return {
        driverId: c.driverId,
        place: c.finishPlace ?? i + 1,
        raceTime: dsq ? Number.POSITIVE_INFINITY : c.raceTime + c.penaltySec,
        bestLapTime: c.bestLapTime,
        gapToLeader: dsq ? 0 : Math.max(0, c.raceTime - leaderTime),
        tyreStops: c.tyreStops,
        fastestLap: !dsq && this.fastestLapDriverId === c.driverId,
        positionsGained: Math.max(0, c.gridPosition - (c.finishPlace ?? i + 1)),
        gridPosition: c.gridPosition,
        dnf: dsq || c.dnf,
      };
    });
    rows.sort((a, b) => a.raceTime - b.raceTime);
    rows.forEach((r, i) => (r.place = i + 1));
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
      const hammerActive = this.time < c.hammerActiveUntil;
      const inCooldown = !hammerActive && this.time < c.hammerReadyAt;
      const hammerRemaining = hammerActive
        ? Math.max(0, c.hammerActiveUntil - this.time)
        : inCooldown ? Math.max(0, c.hammerReadyAt - this.time) : 0;
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
        blueFlag: c.blueFlag,
        lateral: c.lateral,
        hammerTime: {
          active: hammerActive,
          mode: hammerActive ? c.hammerMode : null,
          remainingSec: hammerRemaining,
          cooldownSec: CONFIG.HAMMER_TIME.cooldownSec,
          readyAt: c.hammerReadyAt,
        },
        drsActive: this.time < c.drsActiveUntil,
        tow: c.tow,
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
      weather: this.weather,
      effectiveWeather: this.effectiveWeather,
      timeOfDay: this.timeOfDay,
      trackId: this.config.track.id,
      trackName: this.config.track.name,
      trackCountry: this.config.track.country,
    };
  }
}
