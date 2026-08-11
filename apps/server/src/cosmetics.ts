export type CosmeticType = "accentColor" | "carNumber";

export interface CosmeticDef {
  id: string;
  type: CosmeticType;
  value: string;
  // Soft-currency cost. 0 = a free starting unlock (only the level gate applies).
  cost: number;
  // Minimum pilot level to unlock (cosmetic-only; never affects gameplay).
  level: number;
}

// Level-gated cosmetics catalog. A subset (cost 0, level 1) are free starting unlocks the
// player can equip immediately; the rest cost earnable soft currency + require a level gate.
// Pure data — the client renders from this; the server owns purchase/equip state.
export const COSMETICS: readonly CosmeticDef[] = [
  { id: "accent_blue", type: "accentColor", value: "#3b82f6", cost: 0, level: 1 },
  { id: "accent_green", type: "accentColor", value: "#22c55e", cost: 0, level: 1 },
  { id: "number_7", type: "carNumber", value: "7", cost: 0, level: 1 },
  { id: "number_11", type: "carNumber", value: "11", cost: 50, level: 3 },
  { id: "accent_orange", type: "accentColor", value: "#f97316", cost: 60, level: 4 },
  { id: "accent_purple", type: "accentColor", value: "#a855f7", cost: 80, level: 5 },
  { id: "accent_gold", type: "accentColor", value: "#facc15", cost: 100, level: 6 },
  { id: "number_1", type: "carNumber", value: "1", cost: 120, level: 7 },
  { id: "number_44", type: "carNumber", value: "44", cost: 150, level: 8 },
  { id: "accent_red", type: "accentColor", value: "#ef4444", cost: 200, level: 10 },
];

const COSMETIC_BY_ID: ReadonlyMap<string, CosmeticDef> = new Map(
  COSMETICS.map((c) => [c.id, c]),
);

export function cosmeticById(id: string): CosmeticDef | null {
  return COSMETIC_BY_ID.get(id) ?? null;
}

// Equipped cosmetics are stored as a { type → unlockId } map. Equipping a new item of a type
// replaces the previous one of that type (you can only show one accent color / one number).
export type EquippedCosmetics = Partial<Record<CosmeticType, string>>;

export function parseEquipped(raw: string | null | undefined): EquippedCosmetics {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as EquippedCosmetics;
  } catch {
    // ignore malformed legacy rows → treat as nothing equipped
  }
  return {};
}

export function serializeEquipped(eq: EquippedCosmetics): string {
  return JSON.stringify(eq);
}
