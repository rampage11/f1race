import { WebSocket } from "ws";
import { startServer, type ServerHandle } from "../src/server.js";

export async function launchServer(): Promise<ServerHandle> {
  // Fast lobby timing for tests: MATCH_TICK_MS=50 means a lone player matches into a
  // bot-filled room within ~one tick; SOLO_WAIT_MS=0 lets the tick solo-match immediately;
  // MAX_WAIT_MS=1000 keeps the widener from interfering with short tests.
  process.env.MATCH_TICK_MS = "50";
  process.env.SOLO_WAIT_MS = "0";
  process.env.MAX_WAIT_MS = "1000";
  return startServer(0);
}

export function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

export function send(ws: WebSocket, obj: unknown): void {
  ws.send(JSON.stringify(obj));
}

export class MsgStream {
  private buffer: unknown[] = [];
  private waiters: Array<{
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(ws: WebSocket) {
    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        msg = { __parseError: true, raw: raw.toString() };
      }
      const w = this.waiters.shift();
      if (w) {
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        this.buffer.push(msg);
      }
    });
    ws.on("close", () => {
      while (this.waiters.length) {
        const w = this.waiters.shift()!;
        clearTimeout(w.timer);
        w.reject(new Error("socket closed"));
      }
    });
  }

  next(timeoutMs = 3000): Promise<any> {
    if (this.buffer.length) return Promise.resolve(this.buffer.shift());
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  async waitForType(type: string, timeoutMs = 3000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timeout waiting for type "${type}"`);
      const msg = await this.next(remaining);
      if (msg && typeof msg === "object" && (msg as { type?: string }).type === type) return msg;
    }
  }
}

export async function closeClient(ws: WebSocket): Promise<void> {
  if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 500);
    ws.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      ws.close();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}
