import type { SessionSnapshot } from "./useRaceSession";

const MUTE_KEY = "f1race.audio.muted";
const MASTER_VOLUME = 0.32;
const ENGINE_IDLE_HZ = 78;
const ENGINE_MAX_HZ = 680;
const V_MAX_MS = 95;
const FILTER_MIN_HZ = 220;
const FILTER_MAX_HZ = 2400;
const SMOOTH_TAU = 0.06;
const PIT_TICK_MS = 340;

function readMutePref(): boolean {
  try {
    const raw = localStorage.getItem(MUTE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* localStorage unavailable */
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

function writeMutePref(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* localStorage unavailable */
  }
}

interface PrevState {
  drsActive: boolean;
  hammerActive: boolean;
  position: number | null;
  inPits: boolean;
  hasHero: boolean;
}

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private started = false;
  private _muted: boolean;
  private lastPitTick = 0;
  private prev: PrevState = {
    drsActive: false,
    hammerActive: false,
    position: null,
    inPits: false,
    hasHero: false,
  };

  constructor() {
    this._muted = readMutePref();
  }

  get muted(): boolean {
    return this._muted;
  }

  get available(): boolean {
    return this.started;
  }

  setMuted(value: boolean): void {
    this._muted = value;
    writeMutePref(value);
    this.applyMaster();
  }

  toggleMute(): boolean {
    this.setMuted(!this._muted);
    return this._muted;
  }

  start(): void {
    if (this.started) {
      this.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext | undefined =
        typeof window !== "undefined"
          ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this._muted ? 0 : MASTER_VOLUME;
      master.connect(ctx.destination);

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = "lowpass";
      engineFilter.frequency.value = FILTER_MIN_HZ;
      engineFilter.Q.value = 0.8;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = ENGINE_IDLE_HZ;
      const sub = ctx.createOscillator();
      sub.type = "square";
      sub.frequency.value = ENGINE_IDLE_HZ / 2;

      osc.connect(engineFilter);
      sub.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      osc.start();
      sub.start();

      this.ctx = ctx;
      this.master = master;
      this.engineGain = engineGain;
      this.engineFilter = engineFilter;
      this.engineOsc = osc;
      this.engineSub = sub;
      this.started = true;
      // ramp engine in
      engineGain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.4);
    } catch {
      this.started = false;
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    const target = this._muted ? 0 : MASTER_VOLUME;
    try {
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    } catch {
      this.master.gain.value = target;
    }
  }

  update(snapshot: SessionSnapshot | null, heroId: string): void {
    if (!this.started || !this.ctx || !snapshot) return;
    try {
      const hero = snapshot.cars.find((c) => c.driverId === heroId);
      const now = this.ctx.currentTime;
      const hasHero = !!hero;
      const v = hero ? Math.max(0, Math.min(V_MAX_MS, hero.v)) : 0;
      const t = v / V_MAX_MS;
      const freq = ENGINE_IDLE_HZ + (ENGINE_MAX_HZ - ENGINE_IDLE_HZ) * t;
      const filterHz = FILTER_MIN_HZ + (FILTER_MAX_HZ - FILTER_MIN_HZ) * t;

      if (this.engineOsc) this.engineOsc.frequency.setTargetAtTime(freq, now, SMOOTH_TAU);
      if (this.engineSub) this.engineSub.frequency.setTargetAtTime(freq * 0.5, now, SMOOTH_TAU);
      if (this.engineFilter) this.engineFilter.frequency.setTargetAtTime(filterHz, now, SMOOTH_TAU);

      const drsActive = !!hero?.drsActive;
      const hammerActive = !!hero?.hammerTime?.active;
      const position = hero?.position ?? null;
      const inPits = !!hero?.inPits;

      if (hasHero && !this.prev.hasHero) {
        // (re)entered a race — no triggers, just baseline
      } else if (hasHero) {
        if (drsActive && !this.prev.drsActive) this.beep(1320, 0.07, 0.18);
        if (hammerActive && !this.prev.hammerActive) this.hammerStab();
        if (inPits) {
          const wall = performance.now();
          if (wall - this.lastPitTick > PIT_TICK_MS) {
            this.lastPitTick = wall;
            this.pitTick();
          }
        }
      }

      this.prev = { drsActive, hammerActive, position, inPits, hasHero };
    } catch {
      /* ignore audio errors */
    }
  }

  private beep(freq: number, durSec: number, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durSec);
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + durSec + 0.02);
    } catch {
      /* ignore */
    }
  }

  private hammerStab(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const dur = 0.32;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + dur);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    } catch {
      /* ignore */
    }
  }

  private pitTick(): void {
    this.beep(1900, 0.03, 0.10);
  }

  private overtakeSting(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const base = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99];
      for (let i = 0; i < notes.length; i++) {
        const f = notes[i]!;
        const t0 = base + i * 0.07;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.16, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + 0.22);
      }
    } catch {
      /* ignore */
    }
  }

  private positionLost(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const base = ctx.currentTime;
      const notes = [440.0, 349.23, 261.63];
      for (let i = 0; i < notes.length; i++) {
        const f = notes[i]!;
        const t0 = base + i * 0.08;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.12, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.20);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + 0.24);
      }
    } catch {
      /* ignore */
    }
  }

  triggerOvertake(): void { this.overtakeSting(); }
  triggerPositionLost(): void { this.positionLost(); }

  destroy(): void {
    try {
      this.engineOsc?.stop();
      this.engineSub?.stop();
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.engineOsc = null;
    this.engineSub = null;
    this.started = false;
  }
}
