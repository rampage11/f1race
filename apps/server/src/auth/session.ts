import { createHmac, timingSafeEqual } from "node:crypto";

// Stateless session token format: base64url(payloadJson) + "." + base64url(hmac).
// HMAC is SHA-256 over the base64url(payloadJson) using SESSION_SECRET.
// Verifiable without a DB lookup; constant-time compare on the MAC.

export interface SessionPayload {
  sub: string;
  iat: number;
}

const B64U_RE = /^[A-Za-z0-9_-]+$/;

function b64uEncodeStr(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64uDecodeToBuf(s: string): Buffer | null {
  if (!B64U_RE.test(s)) return null;
  try {
    return Buffer.from(s, "base64url");
  } catch {
    return null;
  }
}

export function signSession(payload: SessionPayload, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64uEncodeStr(payloadJson);
  const mac = createHmac("sha256", secret).update(payloadB64).digest();
  return `${payloadB64}.${mac.toString("base64url")}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0];
  const macB64 = parts[1];
  if (!payloadB64 || !macB64) return null;
  const expectedMac = createHmac("sha256", secret).update(payloadB64).digest();
  const givenMac = b64uDecodeToBuf(macB64);
  if (!givenMac) return null;
  if (givenMac.length !== expectedMac.length) return null;
  if (!timingSafeEqual(givenMac, expectedMac)) return null;
  const payloadBuf = b64uDecodeToBuf(payloadB64);
  if (!payloadBuf) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.sub !== "string" || !obj.sub) return null;
  if (typeof obj.iat !== "number" || !Number.isFinite(obj.iat)) return null;
  return { sub: obj.sub, iat: obj.iat };
}
