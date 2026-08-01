export type SkillKey =
  | "fitness"
  | "reaction"
  | "attack"
  | "defense"
  | "pace"
  | "tyreMgmt";

export type Skills = Record<SkillKey, number>;

export type TyreCompound = "soft" | "medium" | "hard";

export interface TyreState {
  compound: TyreCompound;
  wear: number;
  ageLaps: number;
}

export type DriverKind = "human" | "bot";

export interface Driver {
  id: string;
  name: string;
  country: string;
  kind: DriverKind;
  team: string;
  skills: Skills;
  startingTyre: TyreCompound;
  pitPlan: PitPlan;
  reactionTimeSec: number;
}

export type PitStrategy = "flexible" | "fixed_lap";

export interface PitPlan {
  targetStops: number;
  strategy?: PitStrategy;
  lap?: number;
  compound: TyreCompound;
}

export interface CarState {
  driverId: string;
  gridPosition: number;
  initialS: number;
  s: number;
  v: number;
  lap: number;
  lapStartTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  raceTime: number;
  tyre: TyreState;
  tyreStops: number;
  position: number;
  inPits: boolean;
  pitTimer: number;
  pendingTyre: TyreCompound | null;
  pitLaneTimeTotal: number;
  finished: boolean;
  finishTime: number | null;
  finishPlace: number | null;
  dnf: boolean;
  fatigue: number;
  penaltySec: number;
  overtakeScore: number;
  defendScore: number;
  battleCooldown: number;
  falseStart: boolean;
  effectiveGoDelay: number;
  bonusAccel: number;
  pushLevel: number;
  noiseFactor: number;
  noiseTimer: number;
  trainSize: number;
  blueFlag: boolean;
  overtakingUntil: number;
  overtakingTarget: string | null;
  lateral: number;
  compoundChanged: boolean;
  defendingClose: boolean;
  attackingClose: boolean;
}

export type SegmentKind = "straight" | "corner" | "pitlane";

export interface Point2D {
  x: number;
  y: number;
}

export interface PathPoint extends Point2D {
  angle: number;
}

export interface TrackSegment {
  kind: SegmentKind;
  length: number;
  targetSpeed: number;
  overtaking: number;
}

export interface Track {
  id: string;
  name: string;
  country: string;
  lengthM: number;
  segments: TrackSegment[];
  path2D: Point2D[];
  pitLaneDelta: number;
  pitStopDuration: number;
  pitEntryS: number;
  laps: number;
}

export interface RaceConfig {
  track: Track;
  drivers: Driver[];
  totalLaps: number;
  dt: number;
  seed: number;
  heroId?: string;
}

export interface RaceResultRow {
  driverId: string;
  place: number;
  raceTime: number;
  bestLapTime: number | null;
  gapToLeader: number;
  tyreStops: number;
  fastestLap: boolean;
  positionsGained: number;
  gridPosition: number;
  dnf: boolean;
}

export interface RaceResult {
  rows: RaceResultRow[];
  fastestLapDriverId: string | null;
  events: RaceEvent[];
}

export type RaceEvent =
  | { t: number; type: "race_start" }
  | { t: number; type: "overtake"; attackerId: string; victimId: string; lap: number }
  | { t: number; type: "pit_stop"; driverId: string; compound: TyreCompound; lap: number }
  | { t: number; type: "false_start"; driverId: string }
  | { t: number; type: "finish"; driverId: string; place: number }
  | { t: number; type: "fastest_lap"; driverId: string; lapTime: number }
  | { t: number; type: "info"; message: string };

export interface QualifyingResult {
  driverId: string;
  lapTime: number;
  gridPosition: number;
}

export interface CarSnapshot {
  driverId: string;
  name: string;
  team: string;
  country: string;
  kind: DriverKind;
  position: number;
  gridPosition: number;
  lap: number;
  sFraction: number;
  v: number;
  tyreCompound: TyreCompound;
  tyreWear: number;
  inPits: boolean;
  pitTimer: number;
  finished: boolean;
  dnf: boolean;
  raceTime: number;
  gapAhead: number;
  pitPending: boolean;
  falseStart: boolean;
  overtakeScore: number;
  blueFlag: boolean;
  lateral: number;
}

export interface RaceSnapshot {
  time: number;
  phase: "grid" | "racing" | "finished";
  totalLaps: number;
  trackLengthM: number;
  cars: CarSnapshot[];
  fastestLapDriverId: string | null;
  events: RaceEvent[];
  heroId: string | null;
}
