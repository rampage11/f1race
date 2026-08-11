import { randomUUID } from "node:crypto";
import {
  CONFIG,
  RaceEngine,
  buildRaceConfig,
  divisionForRating,
  driverRating,
  levelFromXp,
  makeBot,
  makeDriver,
  mulberry32,
  redBullRing,
  skillSum,
  type Driver,
  type HammerMode,
  type PilotProfile,
  type RaceSnapshot,
  type RaceResult,
  type TyreCompound,
} from "@f1race/race-engine";
import type { DriverProfile, DriverProfileRepository } from "./persistence/repository.js";
import type { ServerMessage } from "./protocol.js";

export interface TutorialSink {
  send(msg: ServerMessage): void;
  isOpen(): boolean;
}

export interface TutorialOptions {
  /** Wall-clock ms between snapshot ticks (default 100). */
  tickMs?: number;
  /** Sim-time multiplier per tick (default 4 — slower than a real race so hints are readable). */
  speed?: number;
}

const TUTORIAL_LAPS = 3;
const TUTORIAL_XP_BONUS = 30;
// Force-accelerated hero tyre wear: after lap 1 the hero's wear is pushed past the pit-hint
// threshold (0.5). Normal wear rates are tuned for a full ~12-lap race and barely move in a
// 3-lap tutorial, so without this nudge the pit situation never arises.
const TUTORIAL_FORCED_WEAR = 0.55;
// Hammer hint proximity: the hero is "in a battle" when this close (seconds) to the car ahead.
const TUTORIAL_HAMMER_GAP_SEC = 1.0;

type Step = "welcome" | "strategy_intro" | "pit_hint" | "hammer_hint" | "finish";

const STEP_MSG: Record<Step, ServerMessage> = {
  welcome: { type: "tutorialStep", step: "welcome", title: "Гонка", text: "Машина едет сама — ваш ход: пит-стоп и Hammer Time. Следите за подсказками.", highlight: null },
  strategy_intro: { type: "tutorialStep", step: "strategy_intro", title: "Резина", text: "Soft быстрее, но изнашивается скорее. Medium долговечнее — выбирайте под стратегию.", highlight: null },
  pit_hint: { type: "tutorialStep", step: "pit_hint", title: "Время сменить резину", text: "Износ высок! Откройте «Пит-стоп» и выберите свежий состав.", highlight: "pit" },
  hammer_hint: { type: "tutorialStep", step: "hammer_hint", title: "Hammer Time", text: "Атакуйте! Выберите режим, чтобы обогнать соперника.", highlight: "hammer" },
  finish: { type: "tutorialStep", step: "finish", title: "Финиш", text: "Гонка окончена. Дальше — заезды против живых игроков и ботов.", highlight: null },
};

/**
 * Server-driven first-race tutorial. A real 2-lap solo race (hero + 3 docile bots, Red Bull
 * Ring, dry) wrapped so the server can stream `tutorialStep` hints over the snapshot stream at
 * scripted triggers (start / tyre-wear / lap-2 / finish). Reuses the real RaceEngine so the
 * anti-cheat invariant ("client only renders") is preserved — the client just draws overlays
 * on the standard snapshot messages keyed off the step ids.
 *
 * On finish it flips the profile's tutorialCompleted flag and awards a one-time XP bonus, then
 * emits the standard result + progression messages so the existing finish UI works unchanged.
 */
export class TutorialRoom {
  readonly id: string;
  private hero: Driver;
  private heroId: string;
  private engine: RaceEngine;
  private sink: TutorialSink;
  private repository: DriverProfileRepository | null;
  private profile: DriverProfile | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs: number;
  private readonly speed: number;
  private readonly fired = new Set<Step>();
  private finished = false;
  private lastEventSeq = 0;

  constructor(
    sink: TutorialSink,
    heroProfile: PilotProfile,
    repository: DriverProfileRepository | null,
    profile: DriverProfile | null,
    opts: TutorialOptions = {},
  ) {
    this.id = randomUUID();
    this.sink = sink;
    this.repository = repository;
    this.profile = profile;
    this.tickMs = opts.tickMs ?? 100;
    this.speed = opts.speed ?? 4;
    this.heroId = "tutorial-hero";
    const rng = mulberry32(1337);
    const bots: Driver[] = [];
    for (let i = 0; i < 3; i++) {
      bots.push(makeBot({ startingTyre: "medium", skillBudget: 6 }, rng));
    }
    this.hero = makeDriver({
      id: this.heroId,
      name: heroProfile.name || "Вы",
      country: heroProfile.country,
      kind: "human",
      team: heroProfile.team,
      skills: heroProfile.skills,
      // Force soft so the wear story (and strategy_intro soft-vs-medium pitch) is coherent —
      // the hero starts on the quick-but-fragile compound and learns to pit for fresh rubber.
      startingTyre: "soft",
      pitPlan: { targetStops: 1, strategy: "flexible", compound: heroProfile.pitCompound },
    });
    // Hero starts BEHIND one bot (P2 of 4) so there's a car to chase and overtake — that
    // surfaces the hammer-time situation naturally within the short race.
    const drivers = [bots[0]!, this.hero, bots[1]!, bots[2]!];
    const cfg = buildRaceConfig({
      track: redBullRing(),
      drivers,
      totalLaps: TUTORIAL_LAPS,
      seed: 1337,
      dt: CONFIG.physics.dtDefault,
      heroId: this.heroId,
      weather: "dry",
    });
    this.engine = new RaceEngine(cfg);
  }

  start(): void {
    this.send({ type: "welcome", driverId: this.heroId, sessionToken: this.id, mode: "solo" });
    this.send({ type: "stage", stage: "race" });
    this.emitStep("welcome");
    this.emitStep("strategy_intro");
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  handleMessage(msg: { type: string; compound?: TyreCompound; mode?: HammerMode }): void {
    if (this.finished) return;
    if (msg.type === "pit" && msg.compound) {
      this.engine.requestPit(this.heroId, msg.compound);
    } else if (msg.type === "cancelPit") {
      this.engine.cancelPit(this.heroId);
    } else if (msg.type === "hammerTime" && msg.mode) {
      this.engine.requestHammer(this.heroId, msg.mode);
    }
  }

  /** Test-only: drive the race synchronously to completion (no real timer). Mirrors the
    * production tick loop but in-process, so tests can assert the step sequence + completion. */
  __runForTest(maxTicks = 20000): void {
    this.emitStep("welcome");
    this.emitStep("strategy_intro");
    let n = 0;
    while (!this.finished && n < maxTicks) {
      this.tick();
      n++;
    }
  }

  private tick(): void {
    if (!this.sink.isOpen()) {
      this.stop();
      return;
    }
    if (this.engine.phase === "racing") {
      this.engine.step(CONFIG.physics.dtDefault * this.speed);
      this.forceHeroWear();
    }
    const snap: RaceSnapshot = this.engine.snapshot();
    this.send({ type: "snapshot", stage: "race", snapshot: snap, heroId: this.heroId });
    this.checkTriggers(snap);
    if (this.engine.phase === "finished" && !this.finished) {
      this.onFinish();
    }
  }

  // Push the hero's tyre wear past the pit-hint threshold once lap 1 is done. Wear is applied
  // at lap boundaries by the engine, so in a 3-lap race the natural delta (~0.1/lap on soft)
  // never reaches 0.5 — this guarantees the pit situation surfaces.
  private forceHeroWear(): void {
    const heroCar = this.engine.cars.find((c) => c.driverId === this.heroId);
    if (heroCar && heroCar.lap >= 2 && heroCar.tyre.wear < TUTORIAL_FORCED_WEAR) {
      heroCar.tyre.wear = TUTORIAL_FORCED_WEAR;
    }
  }

  private checkTriggers(snap: RaceSnapshot): void {
    const hero = snap.cars.find((c) => c.driverId === this.heroId);
    if (!hero) return;
    // Pit situation: high tyre wear (situation-based, not a fixed lap number).
    if (!this.fired.has("pit_hint") && hero.tyreWear >= 0.5) this.emitStep("pit_hint");
    // Hammer situation: the hero was involved in an overtake since the last tick, OR the hero
    // is within striking distance of the car ahead (gapAhead is 0 for the leader — only check
    // when the hero is NOT in P1).
    if (!this.fired.has("hammer_hint")) {
      const overtakeHero = snap.events.some(
        (e) =>
          e.seq > this.lastEventSeq &&
          e.type === "overtake" &&
          (e.attackerId === this.heroId || e.victimId === this.heroId),
      );
      const closeBattle = hero.position > 1 && hero.gapAhead <= TUTORIAL_HAMMER_GAP_SEC;
      if (overtakeHero || closeBattle) this.emitStep("hammer_hint");
    }
    if (snap.eventSeq > this.lastEventSeq) this.lastEventSeq = snap.eventSeq;
  }

  private emitStep(step: Step): void {
    if (this.fired.has(step)) return;
    this.fired.add(step);
    this.send(STEP_MSG[step]);
  }

  private onFinish(): void {
    this.finished = true;
    this.stop();
    const result: RaceResult = this.engine.result();
    this.send({ type: "result", result, heroId: this.heroId });
    // Award the finish XP bonus ONLY if the hero actually pitted — the tutorial's lesson is the
    // pit stop, so a no-pit run completes the tutorial (tutorialCompleted=true) but earns 0 XP.
    const heroCar = this.engine.cars.find((c) => c.driverId === this.heroId);
    const pitted = heroCar ? heroCar.tyreStops > 0 : false;
    const xpBonus = pitted ? TUTORIAL_XP_BONUS : 0;
    if (this.repository && this.profile) {
      this.repository.markTutorialCompleted(this.profile, xpBonus);
      const level = levelFromXp(this.profile.totalXp);
      let rem = this.profile.totalXp;
      let lvl = 1;
      while (lvl < 999) {
        const need = CONFIG.level.xpToNext(lvl);
        if (rem < need) break;
        rem -= need;
        lvl++;
      }
      const division = divisionForRating(driverRating(level, skillSum(this.profile.hero.skills)));
      this.send({
        type: "progression",
        xpGained: xpBonus,
        totalXp: this.profile.totalXp,
        level,
        xpIntoLevel: rem,
        xpForNext: CONFIG.level.xpToNext(lvl),
        division,
        racesCount: this.profile.racesCount,
      });
    }
    this.emitStep("finish");
  }

  private send(msg: ServerMessage): void {
    if (this.sink.isOpen()) this.sink.send(msg);
  }
}
