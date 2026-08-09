import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PilotProfile } from "@f1race/race-engine";
import type { WebSocket } from "ws";
import type { ServerHandle } from "../src/server.js";
import { closeClient, connectClient, launchServer, send } from "./helpers.js";

const HERO: PilotProfile = {
  name: "Tut Int",
  country: "RU",
  team: "McLaren",
  skills: { fitness: 1, reaction: 1, attack: 2, defense: 2, pace: 3, tyreMgmt: 1 },
  startingTyre: "medium",
  pitCompound: "soft",
};

let handle: ServerHandle;
let prevEnv: Record<string, string | undefined>;

beforeAll(async () => {
  prevEnv = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    DB_PATH: process.env.DB_PATH,
    YANDEX_CLIENT_ID: process.env.YANDEX_CLIENT_ID,
    YANDEX_CLIENT_SECRET: process.env.YANDEX_CLIENT_SECRET,
  };
  process.env.SESSION_SECRET = "tut-int-secret";
  process.env.DB_PATH = ":memory:";
  delete process.env.YANDEX_CLIENT_ID;
  delete process.env.YANDEX_CLIENT_SECRET;
  handle = await launchServer();
});

afterAll(async () => {
  await handle.stop();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = v;
  }
});

// Collect every parsed message arriving on the socket for `windowMs` from a fresh connection
// that immediately requests the tutorial. Robust to ordering/interleaving (the tutorial emits
// welcome → stage → tutorialStep → a stream of snapshots synchronously in start()).
function collectTutorial(ws: WebSocket, windowMs: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const got: unknown[] = [];
    ws.on("message", (raw) => {
      try {
        got.push(JSON.parse(raw.toString()));
      } catch {
        got.push({ __parseError: true });
      }
    });
    setTimeout(() => resolve(got), windowMs);
  });
}

describe("WS tutorial flow", () => {
  it("startTutorial streams welcome + race snapshots + the welcome tutorialStep", async () => {
    const ws: WebSocket = await connectClient(handle.port);
    const done = collectTutorial(ws, 1200);
    // Small grace so the server-side connection handler is ready before we send (the very first
    // upgrade on a freshly launched server can otherwise race the first inbound message).
    await new Promise((r) => setTimeout(r, 50));
    send(ws, { type: "startTutorial", hero: HERO, guestId: "tut-int-guest" });
    const msgs = (await done) as { type?: string; step?: string; mode?: string }[];
    await closeClient(ws);

    const types = msgs.map((m) => m.type);
    expect(types).toContain("welcome");
    expect(types).toContain("snapshot");
    expect(types.some((m) => m === "tutorialStep")).toBe(true);
    const welcome = msgs.find((m) => m.type === "welcome");
    expect(welcome?.mode).toBe("solo");
    const steps = msgs.filter((m) => m.type === "tutorialStep").map((m) => m.step);
    expect(steps[0]).toBe("welcome");
  });
});
