import type { IncomingMessage, ServerResponse } from "node:http";
import { verifySessionToken } from "./session.js";
import { handleYandexCallback, profileSummaryFrom } from "./yandex.js";
import type { DriverProfileRepository } from "../persistence/repository.js";

export interface AuthEnv {
  // null when YANDEX_CLIENT_ID/YANDEX_CLIENT_SECRET are unset → 503 on the callback route.
  yandexClientId: string | null;
  yandexClientSecret: string | null;
  // "" when SESSION_SECRET is unset → verifySessionToken always returns null (auth disabled).
  sessionSecret: string;
  allowedOrigin: string;
  repository: DriverProfileRepository;
}

const CORS_HEADERS_BASE: Record<string, string> = {
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

function corsHeaders(origin: string): Record<string, string> {
  return { ...CORS_HEADERS_BASE, "Access-Control-Allow-Origin": origin };
}

function sendJson(res: ServerResponse, status: number, body: unknown, origin: string): void {
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage, maxBytes = 16384): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    total += buf.length;
    if (total > maxBytes) return null;
    chunks.push(buf);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// Returns true when the request was handled (response written); false to fall through to the
// default health handler.
export async function handleAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: AuthEnv,
): Promise<boolean> {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  const path = url.split("?")[0] ?? url;

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders(env.allowedOrigin));
    res.end();
    return true;
  }

  if (method === "POST" && path === "/auth/yandex/callback") {
    if (!env.yandexClientId || !env.yandexClientSecret || !env.sessionSecret) {
      sendJson(res, 503, { error: "yandex oauth not configured" }, env.allowedOrigin);
      return true;
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "invalid request body" }, env.allowedOrigin);
      return true;
    }
    const obj = body as { code?: unknown; redirectUri?: unknown };
    if (
      typeof obj.code !== "string" ||
      !obj.code ||
      typeof obj.redirectUri !== "string" ||
      !obj.redirectUri
    ) {
      sendJson(res, 400, { error: "code and redirectUri are required" }, env.allowedOrigin);
      return true;
    }
    try {
      const result = await handleYandexCallback({
        code: obj.code,
        redirectUri: obj.redirectUri,
        clientId: env.yandexClientId,
        clientSecret: env.yandexClientSecret,
        sessionSecret: env.sessionSecret,
        repository: env.repository,
      });
      sendJson(res, 200, result, env.allowedOrigin);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = /token exchange/.test(msg) ? 502 : 500;
      sendJson(res, status, { error: msg }, env.allowedOrigin);
    }
    return true;
  }

  if (method === "GET" && path === "/auth/me") {
    if (!env.sessionSecret) {
      sendJson(res, 503, { error: "auth not configured" }, env.allowedOrigin);
      return true;
    }
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.toLowerCase().startsWith("bearer ")) {
      sendJson(res, 401, { error: "missing bearer token" }, env.allowedOrigin);
      return true;
    }
    const token = authHeader.slice("bearer ".length).trim();
    const payload = verifySessionToken(token, env.sessionSecret);
    if (!payload) {
      sendJson(res, 401, { error: "invalid or expired token" }, env.allowedOrigin);
      return true;
    }
    const profile = env.repository.get(payload.sub);
    if (!profile) {
      sendJson(res, 404, { error: "profile not found" }, env.allowedOrigin);
      return true;
    }
    sendJson(res, 200, profileSummaryFrom(profile), env.allowedOrigin);
    return true;
  }

  return false;
}
