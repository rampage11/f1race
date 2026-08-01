import type { PilotProfile, QualySnapshot, RaceResult, RaceSnapshot, TyreCompound } from "@f1race/race-engine";

export type Stage = "qualy" | "race" | "finished";

export type ClientMessage =
  | { type: "hello"; hero: PilotProfile }
  | { type: "restart" }
  | { type: "speed"; value: number }
  | { type: "pause"; paused: boolean }
  | { type: "pit"; compound: TyreCompound };

export type ServerMessage =
  | { type: "stage"; stage: Stage }
  | { type: "snapshot"; stage: Stage; snapshot: QualySnapshot | RaceSnapshot; heroId: string }
  | { type: "result"; result: RaceResult; heroId: string }
  | { type: "error"; message: string };

export type { PilotProfile, QualySnapshot, RaceResult, RaceSnapshot, TyreCompound };
