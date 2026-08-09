import { CONFIG, SKILL_KEYS, STARTING_SKILL_MAX, STARTING_SKILL_POINTS } from "./config.js";
import type { Skills } from "./types.js";

export function emptySkills(): Skills {
  return { fitness: 0, reaction: 0, attack: 0, defense: 0, pace: 0, tyreMgmt: 0 };
}

export function totalPoints(s: Skills): number {
  return SKILL_KEYS.reduce((sum, k) => sum + s[k], 0);
}

export interface SkillAllocationResult {
  ok: boolean;
  errors: string[];
}

export function validateStartingAllocation(s: Skills): SkillAllocationResult {
  const errors: string[] = [];
  const total = totalPoints(s);
  if (total !== STARTING_SKILL_POINTS) {
    errors.push(`Expected exactly ${STARTING_SKILL_POINTS} points, got ${total}`);
  }
  for (const k of SKILL_KEYS) {
    const v = s[k];
    if (!Number.isInteger(v)) errors.push(`${k} must be an integer`);
    if (v < 0) errors.push(`${k} cannot be negative`);
    if (v > STARTING_SKILL_MAX) errors.push(`${k} exceeds starting cap ${STARTING_SKILL_MAX}`);
  }
  return { ok: errors.length === 0, errors };
}

// Respec validation: the new allocation must total exactly `expectedTotal` (point-neutral —
// no gaining or losing points) and each skill is within the absolute cap. Used by the
// /api/profile/respec endpoint; `expectedTotal` is the pilot's current skill sum.
export function validateRespecAllocation(s: Skills, expectedTotal: number): SkillAllocationResult {
  const errors: string[] = [];
  const total = totalPoints(s);
  if (total !== expectedTotal) {
    errors.push(`Expected exactly ${expectedTotal} points, got ${total}`);
  }
  for (const k of SKILL_KEYS) {
    const v = s[k];
    if (!Number.isInteger(v)) errors.push(`${k} must be an integer`);
    if (v < 0) errors.push(`${k} cannot be negative`);
    if (v > CONFIG.skills.absoluteMax) errors.push(`${k} exceeds cap ${CONFIG.skills.absoluteMax}`);
  }
  return { ok: errors.length === 0, errors };
}

export function clampSkill(value: number): number {
  return Math.max(0, Math.min(CONFIG.skills.absoluteMax, Math.round(value)));
}
