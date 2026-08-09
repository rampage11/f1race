import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ABSOLUTE_SKILL_MAX,
  CONFIG,
  SKILL_KEYS,
  divisionForRating,
  driverRating,
  levelFromXp,
  skillSum,
  trainingDurationSec,
  validateRespecAllocation,
  validateStartingAllocation,
  type PilotProfile,
  type SkillKey,
  type Skills,
} from "@f1race/race-engine";
import { verifySessionToken } from "../auth/session.js";
import { profileSummaryFrom } from "../auth/yandex.js";
import type { Division, DriverProfile, DriverProfileRepository, LeaderboardResult, TrainingJob } from "../persistence/repository.js";
import type { DriverProfileSummary } from "../protocol.js";
import { corsHeaders, readJsonBody, sendJson } from "../http-util.js";

const DIVISIONS: readonly Division[] = ["F4", "F3", "F2", "F1"];
function isDivision(v: unknown): v is Division {
  return typeof v === "string" && (DIVISIONS as readonly string[]).includes(v);
}

export interface ApiEnv {
  // "" when SESSION_SECRET is unset → verifySessionToken always returns null (401 on all routes).
  sessionSecret: string;
  allowedOrigin: string;
  repository: DriverProfileRepository;
}

type ActiveTrainingDto = {
  status: "active";
  skill: SkillKey;
  startedAt: number;
  durationSec: number;
  remainingSec: number;
};
type IdleTrainingDto = { status: "idle" };
export type TrainingStateDto = ActiveTrainingDto | IdleTrainingDto;

interface ApiResponse {
  training: TrainingStateDto;
  profile: DriverProfileSummary;
  justCompleted?: { skill: SkillKey; newLevel: number };
}

const SKILL_SET = new Set<string>(SKILL_KEYS);

function isSkillKey(v: unknown): v is SkillKey {
  return typeof v === "string" && SKILL_SET.has(v);
}

// Lazily completes an elapsed active training (applies +1 skill in a transaction) and returns
// the still-active job (if any) plus an optional "justCompleted" signal for client feedback.
function resolveActive(env: ApiEnv, profile: DriverProfile, now: number): {
  active: TrainingJob | null;
  justCompleted?: { skill: SkillKey; newLevel: number };
} {
  const active = env.repository.getActiveTraining(profile.guestId);
  if (!active) return { active: null };
  if (active.startedAt + active.durationSec > now) return { active };
  const skill = active.targetSkill;
  env.repository.completeTraining(active, profile);
  return { active: null, justCompleted: { skill, newLevel: profile.hero.skills[skill] } };
}

function trainingDtoFrom(active: TrainingJob | null, now: number): TrainingStateDto {
  if (!active) return { status: "idle" };
  const remainingMs = active.startedAt + active.durationSec - now;
  return {
    status: "active",
    skill: active.targetSkill,
    startedAt: active.startedAt,
    durationSec: active.durationSec,
    remainingSec: Math.max(0, Math.ceil(remainingMs / 1000)),
  };
}

function buildResponse(env: ApiEnv, profile: DriverProfile, active: TrainingJob | null, now: number, justCompleted?: { skill: SkillKey; newLevel: number }): ApiResponse {
  const resp: ApiResponse = { training: trainingDtoFrom(active, now), profile: profileSummaryFrom(profile) };
  if (justCompleted) resp.justCompleted = justCompleted;
  return resp;
}

// Resolve the bearer token → loaded profile, or null (caller sends 401/404).
function requireProfile(req: IncomingMessage, env: ApiEnv): DriverProfile | null {
  if (!env.sessionSecret) return null;
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice("bearer ".length).trim();
  const payload = verifySessionToken(token, env.sessionSecret);
  if (!payload) return null;
  return env.repository.get(payload.sub);
}

// Returns true when the request was handled (response written); false to fall through to the
// default health handler. Routes: POST /api/profile/confirm, {GET,POST} /api/training/*.
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: ApiEnv,
): Promise<boolean> {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  const path = url.split("?")[0] ?? url;

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders(env.allowedOrigin));
    res.end();
    return true;
  }

  // GET /api/leaderboard?division=F4&limit=50 — top profiles in a division by driverRating,
  // plus the viewer's own rank (`me`) when authed. division defaults to the viewer's; limit
  // clamped to [1, 100]. Only heroConfirmed profiles appear.
  if (method === "GET" && path === "/api/leaderboard") {
    const query = new URL(url, "http://localhost").searchParams;
    const viewer = requireProfile(req, env);
    const divisionParam = query.get("division");
    let division: Division;
    if (isDivision(divisionParam)) {
      division = divisionParam;
    } else if (viewer) {
      division = divisionForRatingOf(viewer);
    } else {
      division = "F4";
    }
    const limit = clampInt(query.get("limit"), 50, 1, 100);
    const result: LeaderboardResult = env.repository.leaderboard(
      division,
      limit,
      viewer?.guestId,
    );
    sendJson(res, 200, result, env.allowedOrigin);
    return true;
  }

  // POST /api/profile/confirm — first-login gate: validate + persist the confirmed hero and
  // flip heroConfirmed. Rejects an already-confirmed profile (no silent respec; see ТЗ §4/§11).
  if (method === "POST" && path === "/api/profile/confirm") {
    const profile = requireProfile(req, env);
    if (!profile) return sendJson401(res, env), true;
    if (profile.heroConfirmed) {
      sendJson(res, 409, { error: "pilot already confirmed" }, env.allowedOrigin);
      return true;
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "invalid request body" }, env.allowedOrigin);
      return true;
    }
    const hero = (body as { hero?: unknown }).hero;
    if (!isValidHero(hero)) {
      sendJson(res, 400, { error: "invalid pilot profile" }, env.allowedOrigin);
      return true;
    }
    const alloc = validateStartingAllocation(hero.skills);
    if (!alloc.ok) {
      sendJson(res, 400, { error: alloc.errors.join("; ") }, env.allowedOrigin);
      return true;
    }
    profile.hero = hero;
    profile.heroConfirmed = true;
    profile.updatedAt = Date.now();
    env.repository.upsert(profile);
    sendJson(res, 200, buildResponse(env, profile, env.repository.getActiveTraining(profile.guestId), Date.now()), env.allowedOrigin);
    return true;
  }

  // POST /api/profile/respec — point-neutral skill redistribution. One free respec at level
  // respec.freeLevel, then a cooldownDays gate (no currency yet). Only `skills` is updated;
  // name/team/country/tyres are preserved. The new allocation must total the pilot's CURRENT
  // skill sum so respec can't be farmed for free points.
  if (method === "POST" && path === "/api/profile/respec") {
    const profile = requireProfile(req, env);
    if (!profile) return sendJson401(res, env), true;
    if (!profile.heroConfirmed) {
      sendJson(res, 403, { error: "confirm your pilot first" }, env.allowedOrigin);
      return true;
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "invalid request body" }, env.allowedOrigin);
      return true;
    }
    const skills = (body as { skills?: unknown }).skills;
    if (!isValidSkills(skills)) {
      sendJson(res, 400, { error: "invalid skills" }, env.allowedOrigin);
      return true;
    }
    const currentSum = skillSum(profile.hero.skills);
    const alloc = validateRespecAllocation(skills, currentSum);
    if (!alloc.ok) {
      sendJson(res, 400, { error: alloc.errors.join("; ") }, env.allowedOrigin);
      return true;
    }
    const now = Date.now();
    const level = levelFromXp(profile.totalXp);
    const freeAvailable = !(profile.freeRespecUsed ?? false) && level >= CONFIG.respec.freeLevel;
    const last = profile.lastRespecAt ?? null;
    if (!freeAvailable) {
      if (last === null) {
        sendJson(res, 409, { error: `respec unlocks at level ${CONFIG.respec.freeLevel}` }, env.allowedOrigin);
        return true;
      }
      const cooldownMs = CONFIG.respec.cooldownDays * 86_400_000;
      if (now - last < cooldownMs) {
        const daysLeft = Math.ceil((cooldownMs - (now - last)) / 86_400_000);
        sendJson(res, 409, { error: `respec available in ${daysLeft} day(s)` }, env.allowedOrigin);
        return true;
      }
    }
    profile.hero = { ...profile.hero, skills };
    if (freeAvailable) profile.freeRespecUsed = true;
    profile.lastRespecAt = now;
    profile.updatedAt = now;
    env.repository.upsert(profile);
    sendJson(res, 200, buildResponse(env, profile, env.repository.getActiveTraining(profile.guestId), now), env.allowedOrigin);
    return true;
  }

  // POST /api/profile/allocateSkill — spend ONE banked level-up skill point on `skill`
  // (clamped at the absolute cap). 409 when there are no unspent points or the skill is maxed.
  if (method === "POST" && path === "/api/profile/allocateSkill") {
    const profile = requireProfile(req, env);
    if (!profile) return sendJson401(res, env), true;
    if (!profile.heroConfirmed) {
      sendJson(res, 403, { error: "confirm your pilot first" }, env.allowedOrigin);
      return true;
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "invalid request body" }, env.allowedOrigin);
      return true;
    }
    const skill = (body as { skill?: unknown }).skill;
    if (!isSkillKey(skill)) {
      sendJson(res, 400, { error: "skill must be one of: " + SKILL_KEYS.join(", ") }, env.allowedOrigin);
      return true;
    }
    const ok = env.repository.allocateSkillPoint(profile, skill);
    if (!ok) {
      const reason = (profile.unspentSkillPoints ?? 0) <= 0 ? "no skill points to spend" : `${skill} is already at the maximum`;
      sendJson(res, 409, { error: reason }, env.allowedOrigin);
      return true;
    }
    sendJson(res, 200, buildResponse(env, profile, env.repository.getActiveTraining(profile.guestId), Date.now()), env.allowedOrigin);
    return true;
  }

  if ((method === "GET" || method === "POST") && path.startsWith("/api/training")) {
    const profile = requireProfile(req, env);
    if (!profile) return sendJson401(res, env), true;

    // Training requires a confirmed pilot (the gated Yandex flow). An unconfirmed profile has
    // only the placeholder DEFAULT_YANDEX_HERO; training it would be meaningless.
    if (!profile.heroConfirmed) {
      sendJson(res, 403, { error: "confirm your pilot first" }, env.allowedOrigin);
      return true;
    }

    if (method === "GET" && path === "/api/training/state") {
      const now = Date.now();
      const { active, justCompleted } = resolveActive(env, profile, now);
      sendJson(res, 200, buildResponse(env, profile, active, now, justCompleted), env.allowedOrigin);
      return true;
    }

    if (method === "POST" && path === "/api/training/cancel") {
      const active = env.repository.getActiveTraining(profile.guestId);
      if (active) env.repository.cancelTraining(active.id);
      const now = Date.now();
      sendJson(res, 200, buildResponse(env, profile, env.repository.getActiveTraining(profile.guestId), now), env.allowedOrigin);
      return true;
    }

    if (method === "POST" && path === "/api/training/start") {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") {
        sendJson(res, 400, { error: "invalid request body" }, env.allowedOrigin);
        return true;
      }
      const skill = (body as { skill?: unknown }).skill;
      if (!isSkillKey(skill)) {
        sendJson(res, 400, { error: "skill must be one of: " + SKILL_KEYS.join(", ") }, env.allowedOrigin);
        return true;
      }
      const now = Date.now();
      // Finish any elapsed training first (lazy completion on the start path too).
      const { justCompleted } = resolveActive(env, profile, now);
      let active = env.repository.getActiveTraining(profile.guestId);
      if (active) {
        sendJson(res, 409, { error: "a training is already active", ...buildResponse(env, profile, active, now, justCompleted) }, env.allowedOrigin);
        return true;
      }
      const currentLevel = profile.hero.skills[skill];
      if (currentLevel >= ABSOLUTE_SKILL_MAX) {
        sendJson(res, 400, { error: `${skill} is already at the maximum (${ABSOLUTE_SKILL_MAX})`, ...buildResponse(env, profile, null, now, justCompleted) }, env.allowedOrigin);
        return true;
      }
      const durationSec = trainingDurationSec(currentLevel, levelFromXp(profile.totalXp));
      active = env.repository.startTraining(profile.guestId, skill, now, durationSec);
      sendJson(res, 200, buildResponse(env, profile, active, now, justCompleted), env.allowedOrigin);
      return true;
    }
  }

  return false;
}

function sendJson401(res: ServerResponse, env: ApiEnv): void {
  sendJson(res, 401, { error: "missing or invalid bearer token" }, env.allowedOrigin);
}

function isValidSkills(v: unknown): v is Skills {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  for (const k of SKILL_KEYS) {
    if (typeof s[k] !== "number" || !Number.isFinite(s[k] as number)) return false;
  }
  return true;
}

function divisionForRatingOf(profile: DriverProfile): Division {
  const level = levelFromXp(profile.totalXp);
  return divisionForRating(driverRating(level, skillSum(profile.hero.skills)));
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw == null || raw === "") return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function isValidHero(v: unknown): v is PilotProfile {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.country !== "string" || typeof o.team !== "string") return false;
  if (typeof o.startingTyre !== "string" || typeof o.pitCompound !== "string") return false;
  const s = o.skills;
  if (!s || typeof s !== "object") return false;
  const skills = s as Record<string, unknown>;
  for (const k of SKILL_KEYS) {
    if (typeof skills[k] !== "number" || !Number.isFinite(skills[k] as number)) return false;
  }
  return true;
}
