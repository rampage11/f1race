import {
  divisionForRating,
  driverRating,
  emptySkills,
  levelFromXp,
  skillSum,
  type PilotProfile,
} from "@f1race/race-engine";
import type { Division, DriverProfileSummary } from "../protocol.js";
import type { DriverProfile, DriverProfileRepository } from "../persistence/repository.js";
import { signSession, type SessionPayload } from "./session.js";

// Mirrors apps/web/src/race/SetupScreen.tsx DEFAULTS — keep in sync. A brand-new Yandex user
// has no stored hero (OAuth carries none), so they start with this profile. The web client
// receives it via the /auth/yandex/callback response and may let the user edit it; the next
// `hello` carrying `hero` + `authToken` then updates the stored hero via resolveHeroProfile.
export const DEFAULT_YANDEX_HERO: PilotProfile = {
  name: "",
  country: "RU",
  team: "McLaren",
  skills: { ...emptySkills(), pace: 3, attack: 2, defense: 2, fitness: 1, reaction: 1, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
const YANDEX_USERINFO_URL = "https://login.yandex.ru/info?format=json";

export interface YandexUserInfo {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface YandexTokenResponse {
  access_token?: unknown;
}

interface YandexUserInfoResponse {
  id?: unknown;
  default_email?: unknown;
  emails?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  real_name?: unknown;
  display_name?: unknown;
}

export interface CallbackResult {
  sessionToken: string;
  profileSummary: DriverProfileSummary;
  isNewUser: boolean;
}

export function profileSummaryFrom(p: DriverProfile): DriverProfileSummary {
  const level = levelFromXp(p.totalXp);
  const rating = driverRating(level, skillSum(p.hero.skills));
  return {
    guestId: p.guestId,
    hero: p.hero,
    level,
    division: divisionForRating(rating) as Division,
    driverRating: rating,
    heroConfirmed: p.heroConfirmed,
    totalXp: p.totalXp,
    racesCount: p.racesCount,
    tutorialCompleted: p.tutorialCompleted ?? true,
    unspentSkillPoints: p.unspentSkillPoints ?? 0,
  };
}

export function yandexKey(yandexId: string): string {
  return `yandex:${yandexId}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const resp = await fetchImpl(YANDEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!resp.ok) {
    throw new Error(`yandex token exchange failed: ${resp.status}`);
  }
  const data = (await resp.json()) as YandexTokenResponse;
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("yandex token exchange failed: no access_token");
  }
  return data.access_token;
}

export async function fetchYandexUserInfo(
  accessToken: string,
  fetchImpl: FetchLike,
): Promise<YandexUserInfo> {
  const resp = await fetchImpl(YANDEX_USERINFO_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`yandex user info failed: ${resp.status}`);
  }
  const info = (await resp.json()) as YandexUserInfoResponse;
  if (typeof info.id !== "string" || !info.id) {
    throw new Error("yandex user info missing id");
  }
  let email: string | null = null;
  if (typeof info.default_email === "string" && info.default_email) email = info.default_email;
  else if (Array.isArray(info.emails) && typeof info.emails[0] === "string") email = info.emails[0];
  const firstName =
    (typeof info.first_name === "string" && info.first_name) ||
    (typeof info.real_name === "string" && info.real_name) ||
    (typeof info.display_name === "string" && info.display_name) ||
    "";
  const lastName = typeof info.last_name === "string" ? info.last_name : "";
  return { id: info.id, email, firstName, lastName };
}

export interface HandleCallbackArgs {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  repository: DriverProfileRepository;
  fetchImpl?: FetchLike;
}

export async function handleYandexCallback(args: HandleCallbackArgs): Promise<CallbackResult> {
  const fetchImpl = args.fetchImpl ?? (globalThis.fetch as FetchLike);
  const accessToken = await exchangeCodeForToken(
    args.code,
    args.redirectUri,
    args.clientId,
    args.clientSecret,
    fetchImpl,
  );
  const info = await fetchYandexUserInfo(accessToken, fetchImpl);
  const key = yandexKey(info.id);
  const now = Date.now();
  let isNewUser = false;
  let profile = args.repository.get(key);
  if (!profile) {
    isNewUser = true;
    profile = {
      guestId: key,
      hero: DEFAULT_YANDEX_HERO,
      totalXp: 0,
      racesCount: 0,
      // Force the first-login SetupScreen gate; flipped by POST /api/profile/confirm.
      heroConfirmed: false,
      createdAt: now,
      updatedAt: now,
    };
    args.repository.upsert(profile);
  }
  const payload: SessionPayload = { sub: key, iat: now };
  const sessionToken = signSession(payload, args.sessionSecret);
  return {
    sessionToken,
    profileSummary: profileSummaryFrom(profile),
    isNewUser,
  };
}
