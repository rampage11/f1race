import type { PilotProfile } from "@f1race/race-engine";

const GUEST_ID_KEY = "f1race.guestId";
const PROFILE_KEY = "f1race.profile";
const AUTH_TOKEN_KEY = "f1race.authToken";
const AUTH_PROFILE_KEY = "f1race.authProfile";
const YANDEX_STATE_KEY = "yandex_oauth_state";

export const YANDEX_CALLBACK_PATH = "/play/yandex-callback";

export type Division = "F4" | "F3" | "F2" | "F1";

export interface DriverProfileSummary {
  guestId: string;
  hero: PilotProfile;
  level: number;
  division: Division;
  driverRating: number;
  heroConfirmed: boolean;
  totalXp: number;
  racesCount: number;
}

function normalizeProfile(parsed: Partial<DriverProfileSummary>): DriverProfileSummary | null {
  if (typeof parsed.guestId === "string" && typeof parsed.level === "number" && parsed.hero) {
    return {
      ...parsed,
      driverRating: typeof parsed.driverRating === "number" ? parsed.driverRating : 0,
      heroConfirmed: typeof parsed.heroConfirmed === "boolean" ? parsed.heroConfirmed : false,
    } as DriverProfileSummary;
  }
  return null;
}

let memoryGuestId: string | null = null;

function uuidv4(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}`;
}

export function getOrCreateGuestId(): string {
  if (memoryGuestId) return memoryGuestId;
  try {
    const existing = localStorage.getItem(GUEST_ID_KEY);
    if (existing) {
      memoryGuestId = existing;
      return existing;
    }
    const id = uuidv4();
    localStorage.setItem(GUEST_ID_KEY, id);
    memoryGuestId = id;
    return id;
  } catch {
    if (!memoryGuestId) memoryGuestId = uuidv4();
    return memoryGuestId;
  }
}

export function readCachedProfile(): DriverProfileSummary | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw) as Partial<DriverProfileSummary>);
  } catch {
    return null;
  }
}

export function writeCachedProfile(profile: DriverProfileSummary): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* localStorage unavailable */
  }
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

export function getAuthProfile(): DriverProfileSummary | null {
  try {
    const raw = localStorage.getItem(AUTH_PROFILE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw) as Partial<DriverProfileSummary>);
  } catch {
    return null;
  }
}

export function setAuthProfile(profile: DriverProfileSummary | null): void {
  try {
    if (profile) localStorage.setItem(AUTH_PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(AUTH_PROFILE_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

export function clearAuth(): void {
  setAuthToken(null);
  setAuthProfile(null);
}

export function yandexClientId(): string | null {
  const id = import.meta.env.VITE_YANDEX_CLIENT_ID as string | undefined;
  return id && id.trim().length > 0 ? id : null;
}

export function apiBaseUrl(): string {
  const ws = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787";
  // Derive the HTTP ORIGIN only (scheme + host[:port]). VITE_WS_URL may carry a path
  // (prod is `wss://f1-race.ru/ws`); stripping the path is critical — otherwise every HTTP
  // API call is built as `${wsUrl}/auth/...` → `/ws/auth/...` and hits the WS proxy location
  // instead of the auth/api routes. The WS connection itself uses VITE_WS_URL verbatim.
  try {
    const u = new URL(ws);
    const scheme = u.protocol === "wss:" ? "https:" : "http:";
    return `${scheme}//${u.host}`;
  } catch {
    return ws;
  }
}

export function isYandexCallbackPath(): boolean {
  const p = window.location.pathname;
  return p === YANDEX_CALLBACK_PATH || p.startsWith(`${YANDEX_CALLBACK_PATH}/`);
}

export interface YandexCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
}

export function readYandexCallbackParams(): YandexCallbackParams {
  const params = new URLSearchParams(window.location.search);
  return { code: params.get("code"), state: params.get("state"), error: params.get("error") };
}

export function consumeYandexState(returnedState: string | null): boolean {
  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(YANDEX_STATE_KEY);
    sessionStorage.removeItem(YANDEX_STATE_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
  return !!expected && !!returnedState && expected === returnedState;
}

export function beginYandexLogin(): void {
  const clientId = yandexClientId();
  if (!clientId) return;
  const state = uuidv4();
  try {
    sessionStorage.setItem(YANDEX_STATE_KEY, state);
  } catch {
    /* sessionStorage unavailable */
  }
  const redirectUri = `${window.location.origin}${YANDEX_CALLBACK_PATH}`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: "login:email login:info",
    force_confirm: "yes",
  });
  window.location.href = `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

export interface YandexExchangeResult {
  ok: boolean;
  sessionToken?: string;
  profile?: DriverProfileSummary;
  isNewUser?: boolean;
  error?: string;
  notConfigured?: boolean;
}

export async function exchangeYandexCode(code: string, redirectUri: string): Promise<YandexExchangeResult> {
  try {
    const res = await fetch(`${apiBaseUrl()}/auth/yandex/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri }),
    });
    const data = (await res.json().catch(() => null)) as {
      sessionToken?: string;
      profileSummary?: DriverProfileSummary;
      isNewUser?: boolean;
      error?: string;
    } | null;
    if (res.ok && data?.sessionToken && data?.profileSummary) {
      return { ok: true, sessionToken: data.sessionToken, profile: data.profileSummary, isNewUser: data.isNewUser };
    }
    if (res.status === 503) return { ok: false, error: data?.error ?? "yandex oauth not configured", notConfigured: true };
    return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
