import type { TyreCompound } from "@f1race/race-engine";

export const TEAM_COLORS: Record<string, string> = {
  "Red Bull": "#1E3A8A",
  Ferrari: "#DC2626",
  Mercedes: "#00A19B",
  McLaren: "#F97316",
  "Aston Martin": "#15803D",
  Alpine: "#7C3AED",
  Williams: "#0EA5E9",
  AlphaTauri: "#475569",
  Sauber: "#16A34A",
  Haas: "#E5E7EB",
  Academy: "#FBBF24",
};

export const TYRE_COLORS: Record<TyreCompound, string> = {
  soft: "#EF4444",
  medium: "#EAB308",
  hard: "#F1F5F9",
};

export const TYRE_LABEL: Record<TyreCompound, string> = {
  soft: "Soft",
  medium: "Medium",
  hard: "Hard",
};

export function teamColor(team: string): string {
  return TEAM_COLORS[team] ?? "#9CA3AF";
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}

export function formatRaceTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function formatGap(sec: number): string {
  if (sec <= 0.05) return "—";
  if (sec >= 60) return `+${(sec / 60).toFixed(1)}l`;
  return `+${sec.toFixed(2)}`;
}
