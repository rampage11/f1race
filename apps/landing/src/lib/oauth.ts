const YANDEX_CALLBACK_PATH = "/yandex-callback";

function yandexClientId(): string | null {
  const id = import.meta.env.VITE_YANDEX_CLIENT_ID as string | undefined;
  return id && id.trim().length > 0 ? id : null;
}

function gameOrigin(): string {
  const explicit = import.meta.env.VITE_GAME_URL as string | undefined;
  if (explicit) return explicit.replace(/\/$/, "");
  return window.location.origin;
}

function uuidv4(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 12)}`;
}

export function isYandexConfigured(): boolean {
  return yandexClientId() !== null;
}

export function beginYandexLogin(): void {
  const clientId = yandexClientId();
  if (!clientId) return;
  const state = uuidv4();
  try {
    sessionStorage.setItem("yandex_oauth_state", state);
  } catch {
    /* sessionStorage unavailable */
  }
  const redirectUri = `${gameOrigin()}${YANDEX_CALLBACK_PATH}`;
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
