import type { PilotProfile, SkillKey, Skills } from "@f1race/race-engine";
import { apiBaseUrl, getAuthToken } from "./identity";
import type { DriverProfileSummary } from "./identity";

export interface TrainingStateIdleDto {
  status: "idle";
}

export interface TrainingStateActiveDto {
  status: "active";
  skill: SkillKey;
  startedAt: number;
  durationSec: number;
  remainingSec: number;
}

export type TrainingStateDto = TrainingStateIdleDto | TrainingStateActiveDto;

export interface TrainingStateResponse {
  training: TrainingStateDto;
  profile: DriverProfileSummary;
  justCompleted?: { skill: SkillKey; newLevel: number };
}

export type TrainingCallResult = TrainingStateResponse | { error: string };

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function fetchProfile(): Promise<DriverProfileSummary | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(`${apiBaseUrl()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as DriverProfileSummary;
  } catch {
    return null;
  }
}

export interface ConfirmResult {
  ok: boolean;
  profile?: DriverProfileSummary;
  error?: string;
}

export async function confirmHero(hero: PilotProfile): Promise<ConfirmResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/profile/confirm`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ hero }),
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (res.status === 409) {
    const profile = await fetchProfile();
    return { ok: true, profile: profile ?? undefined, error: "already-confirmed" };
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  }
  const data = (await res.json().catch(() => null)) as { profile?: DriverProfileSummary } | null;
  return { ok: !!data?.profile, profile: data?.profile };
}

export async function fetchTrainingState(): Promise<TrainingStateResponse | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch(`${apiBaseUrl()}/api/training/state`, { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as TrainingStateResponse;
  } catch {
    return null;
  }
}

export async function startTraining(skill: SkillKey): Promise<TrainingCallResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/training/start`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ skill }),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { error: data?.error ?? `HTTP ${res.status}` };
  }
  return (await res.json()) as TrainingStateResponse;
}

export async function cancelTraining(): Promise<TrainingCallResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/training/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { error: data?.error ?? `HTTP ${res.status}` };
  }
  return (await res.json()) as TrainingStateResponse;
}

export type RespecResult = { ok: true; profile: DriverProfileSummary } | { ok: false; error: string };

export async function respecSkills(skills: Skills): Promise<RespecResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/profile/respec`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ skills }),
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  }
  const data = (await res.json().catch(() => null)) as { profile?: DriverProfileSummary } | null;
  if (!data?.profile) return { ok: false, error: "invalid response" };
  return { ok: true, profile: data.profile };
}
