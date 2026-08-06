import type { IncomingMessage, ServerResponse } from "node:http";

export const CORS_HEADERS_BASE: Record<string, string> = {
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

export function corsHeaders(origin: string): Record<string, string> {
  return { ...CORS_HEADERS_BASE, "Access-Control-Allow-Origin": origin };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, origin: string): void {
  const headers = corsHeaders(origin);
  headers["Content-Type"] = "application/json";
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req: IncomingMessage, maxBytes = 16384): Promise<unknown | null> {
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
