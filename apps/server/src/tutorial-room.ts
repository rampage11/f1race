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

type Step = "welcome" | "pit_hint" | "hammer_hint" | "finish";

const STEP_MSG: Record<Step, ServerMessage> = {
  welcome: { type: "tutorialStep", step: "welcome", title: "Гонка", text: "Машина едет сама — ваш ход: пит-стоп и Hammer Time. Следите за подсказками.", highlight: null },
  pit_hint: { type: "tutorialStep", step: "pit_hint", title: "Время сменить резину", text: "Откройте панель «Пит-стоп» и выберите другой состав. Свежая резина быстрее.", highlight: "pit" },
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
      startingTyre: heroProfile.startingTyre,
      pitPlan: { targetStops: 1, strategy: "flexible", compound: heroProfile.pitCompound },
    });
    // Hero starts at the front of a small grid so the race is gentle and finishable.
    const drivers = [this.hero, ...bots];
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
    }
    const snap: RaceSnapshot = this.engine.snapshot();
    this.send({ type: "snapshot", stage: "race", snapshot: snap, heroId: this.heroId });
    this.checkTriggers(snap);
    if (this.engine.phase === "finished" && !this.finished) {
      this.onFinish();
    }
  }

  private checkTriggers(snap: RaceSnapshot): void {
    const hero = snap.cars.find((c) => c.driverId === this.heroId);
    if (!hero) return;
    // Lap-based triggers (robust for a short race — wear wouldn't reach the cliff in 3 laps).
    if (!this.fired.has("pit_hint") && hero.lap >= 1) this.emitStep("pit_hint");
    if (!this.fired.has("hammer_hint") && hero.lap >= 2) this.emitStep("hammer_hint");
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
    if (this.repository && this.profile) {
      this.repository.markTutorialCompleted(this.profile, TUTORIAL_XP_BONUS);
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
        xpGained: TUTORIAL_XP_BONUS,
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
