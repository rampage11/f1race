import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { validateStartingAllocation, type PilotProfile } from "@f1race/race-engine";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { Room, resolveHeroProfile, type RoomSink } from "./room.js";
import { Lobby, divisionOf } from "./lobby.js";
import { TutorialRoom } from "./tutorial-room.js";
import { createRepository, type DriverProfileRepository } from "./persistence/index.js";
import { handleAuthRequest, verifySessionToken, type AuthEnv } from "./auth/index.js";
import { handleApiRequest, isValidHero, type ApiEnv } from "./api/http.js";
import { corsHeaders, sendJson } from "./http-util.js";
import { log } from "./logger.js";
import {
  createHttpRateLimiters,
  resolveRateBucket,
  type HttpRateLimiters,
} from "./rate-limit.js";

const DEFAULT_DB_PATH = "./data/f1race.db";
const STARTED_AT = Date.now();

export interface ServerHandle {
  port: number;
  server: Server;
  wss: WebSocketServer;
  // Exposed so tests can drive a matched room via Room.__advanceForTest (reaching a real
  // race takes minutes; the seam reuses production step methods). Not for production callers.
  rooms: Map<string, Room>;
  // Exposed for /health (counts rooms + queued clients). Not for production callers.
  lobby: Lobby;
  repository: DriverProfileRepository;
  rateLimiters: HttpRateLimiters;
  stop(): Promise<void>;
}

interface ConnState {
  ws: WebSocket;
  connectionId: string;
  room: Room | null;
  tutorial: TutorialRoom | null;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function boundPort(server: Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server is not listening");
}

export function startServer(port: number = Number(process.env.PORT ?? 8787)): Promise<ServerHandle> {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  const repository: DriverProfileRepository = createRepository(dbPath);

  // Yandex OAuth + session token config. When unset, the server boots normally and the
  // /auth/yandex/callback route returns 503; WS runs in pure-guest mode (verifySessionToken
  // returns null for any token when sessionSecret is "").
  const yandexClientId = process.env.YANDEX_CLIENT_ID ?? null;
  const yandexClientSecret = process.env.YANDEX_CLIENT_SECRET ?? null;
  const providedSessionSecret = process.env.SESSION_SECRET ?? null;
  if ((yandexClientId || yandexClientSecret) && !providedSessionSecret) {
    throw new Error("SESSION_SECRET is required when YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET are set");
  }
  const sessionSecret = providedSessionSecret ?? "";
  const authEnv: AuthEnv = {
    yandexClientId,
    yandexClientSecret,
    sessionSecret,
    allowedOrigin: ALLOWED_ORIGIN,
    repository,
  };
  const apiEnv: ApiEnv = { sessionSecret, allowedOrigin: ALLOWED_ORIGIN, repository };
  const rateLimiters = createHttpRateLimiters();

  const rooms = new Map<string, Room>();
  const conns = new Map<string, ConnState>();

  const cleanupRoom = (room: Room | null): void => {
    if (!room) return;
    if (room.connectionCount === 0) {
      room.stop();
      rooms.delete(room.id);
    }
  };

  const makeSink = (ws: WebSocket): RoomSink => ({
    send: (m) => send(ws, m),
    isOpen: () => ws.readyState === ws.OPEN,
  });

  const registerRoom = (room: Room): Room => {
    room.onEmpty = () => {
      rooms.delete(room.id);
      log.info("room.finished", { roomId: room.id, mode: room.mode });
    };
    rooms.set(room.id, room);
    log.info("room.created", { roomId: room.id, mode: room.mode });
    return room;
  };

  const lobby = new Lobby(
    () => registerRoom(new Room(repository)),
    (connId, room) => {
      const c = conns.get(connId);
      if (c) c.room = room;
    },
  );

  const server = createServer(async (req, res) => {
    const url0 = req.url ?? "";
    const method0 = req.method ?? "GET";
    const path0 = url0.split("?")[0] ?? url0;

    // /health — explicit, exempt from auth/api dispatch AND from rate limiting.
    if (method0 === "GET" && (path0 === "/health" || path0 === "/")) {
      const dbOk = safePing(repository);
      const status = dbOk ? "ok" : "degraded";
      const body = {
        service: "f1race-server",
        status,
        uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
        rooms: rooms.size,
        queuedClients: lobby.queuedCount,
        db: dbOk ? "ok" : "fail",
      };
      const code = dbOk ? 200 : 503;
      const headers = corsHeaders(ALLOWED_ORIGIN);
      headers["Content-Type"] = "application/json";
      headers["Cache-Control"] = "no-store";
      res.writeHead(code, headers);
      res.end(JSON.stringify(body));
      return;
    }

    // Rate limiting on /auth/* and /api/* (S3-6). Skip OPTIONS preflights (handled per-route).
    const rb = resolveRateBucket(method0, path0, rateLimiters);
    if (rb) {
      const ip = clientIp(req);
      if (!rb.limiter.consume(ip)) {
        const retry = rb.limiter.retryAfterSec(ip);
        const headers = corsHeaders(ALLOWED_ORIGIN);
        headers["Content-Type"] = "application/json";
        headers["Retry-After"] = String(retry);
        res.writeHead(429, headers);
        res.end(JSON.stringify({ error: "rate limited", retryAfterSec: retry }));
        return;
      }
    }

    if (await handleAuthRequest(req, res, authEnv)) return;
    if (await handleApiRequest(req, res, apiEnv)) return;
    // Unknown path → 404 (previously fell through to a default 200 "ok", which masked
    // misconfigured routes). OPTIONS for any path is answered by the route handlers above
    // with a 204 preflight; here we only reach when nothing matched.
    sendJson(res, 404, { error: "not found" }, ALLOWED_ORIGIN);
  });

  const wss = new WebSocketServer({ server });
  lobby.start();

  wss.on("connection", (ws: WebSocket, req) => {
    const conn: ConnState = { ws, connectionId: randomUUID(), room: null, tutorial: null };
    conns.set(conn.connectionId, conn);
    log.info("ws.open", { connectionId: conn.connectionId, ip: clientIp(req) });
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send(ws, { type: "error", message: "invalid json" });
      }
      handle(conn, msg, rooms, cleanupRoom, makeSink, repository, lobby, sessionSecret);
    });
    ws.on("close", () => {
      log.info("ws.close", { connectionId: conn.connectionId });
      onConnClosed(conn);
    });
    ws.on("error", (err) => {
      log.warn("ws.error", { connectionId: conn.connectionId, error: err.message });
      onConnClosed(conn);
    });
  });

  function onConnClosed(conn: ConnState): void {
    if (conn.tutorial) {
      conn.tutorial.stop();
      conn.tutorial = null;
    }
    const room = conn.room;
    if (room) {
      room.removeConnection(conn.connectionId);
      cleanupRoom(room);
    } else {
      lobby.dequeue(conn.connectionId);
    }
    conns.delete(conn.connectionId);
    conn.room = null;
  }

  // Idempotent teardown (S0-4): safe to call from tests, signal handlers, or repeated calls.
  // Each closure resource is guarded so a second invocation can't throw on an already-closed
  // wss / http server / repository. Returns the same Promise on repeat calls.
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  const doStop = (): Promise<void> => {
    if (stopped) return stopPromise!;
    stopped = true;
    stopPromise = (async () => {
      try { lobby.stop(); } catch {}
      for (const room of rooms.values()) {
        try { room.stop(); } catch {}
      }
      rooms.clear();
      for (const c of wss.clients) {
        try { c.close(); } catch {}
      }
      try { repository.close(); } catch {}
      await Promise.all([
        new Promise<void>((r) => {
          try { wss.close(() => r()); } catch { r(); }
        }),
        new Promise<void>((r) => {
          try { server.close(() => r()); } catch { r(); }
        }),
      ]);
    })();
    return stopPromise;
  };

  return new Promise<ServerHandle>((resolve) => {
    server.listen(port, () => {
      const actual = boundPort(server);
      const mode = sessionSecret ? "auth-enabled" : "guest-only";
      log.info("server.start", { port: actual, origin: ALLOWED_ORIGIN, db: dbPath, mode });
      // S0-4: graceful shutdown on SIGTERM (systemd) / SIGINT (Ctrl-C). Broadcast a notice,
      // then run the same idempotent teardown `stop()` uses, with a 5s hard fallback so a
      // stuck close never wedges the process. `process.once` so a repeat signal falls through
      // to Node's default handler (immediate termination).
      const installShutdownSignal = (sig: NodeJS.Signals): void => {
        process.once(sig, () => {
          log.info("server.shutdown", { signal: sig });
          const hardExit = setTimeout(() => {
            log.error("server.shutdown.timeout", { ms: 5000 });
            process.exit(0);
          }, 5000);
          hardExit.unref();
          const notice: ServerMessage = { type: "error", message: "сервер перезапускается" };
          for (const c of wss.clients) {
            try {
              if (c.readyState === c.OPEN) c.send(JSON.stringify(notice));
            } catch {}
          }
          doStop().finally(() => {
            clearTimeout(hardExit);
            process.exit(0);
          });
        });
      };
      installShutdownSignal("SIGTERM");
      installShutdownSignal("SIGINT");
      resolve({
        port: actual,
        server,
        wss,
        rooms,
        lobby,
        repository,
        rateLimiters,
        stop: doStop,
      });
    });
  });
}

// DB-readable probe for /health. Wraps `repository.ping()` so a broken DB doesn't crash
// the health route itself — the request still answers (with a "degraded"/503 payload).
function safePing(repo: DriverProfileRepository): boolean {
  try {
    return repo.ping();
  } catch {
    return false;
  }
}

// Best-effort client-IP extraction for rate-limit keying. Behind nginx (prod), the
// `x-forwarded-for` header carries the real client (first hop); without it (dev/tests)
// we fall back to the raw socket address. Either way this is just a bucket key — getting
// it wrong only affects which bucket gets debited, not authorization.
function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  // req.socket.remoteAddress is undefined for kept-alive/inline tests; default to "local".
  return req.socket.remoteAddress ?? "unknown";
}

function applyOrError(ws: WebSocket, error: string | null): void {
  if (error) send(ws, { type: "error", message: error });
}

// S0-1 anti-cheat: validate a client-supplied hero at the WS boundary before it can reach
// resolveHeroProfile. Shape is always checked; the starting allocation is checked ONLY for
// pilots without a confirmed profile (a confirmed pilot may have accumulated skills via
// training/respec/allocateSkill and the client merely echoes them back — the server owns
// those values, so we strip skills/tyres from the wire here and resolveHeroProfile applies
// the same defense-in-depth on its own branch).
function validateClientHero(
  repository: DriverProfileRepository,
  rawHero: PilotProfile,
  guestId: string | undefined,
): { ok: true; hero: PilotProfile } | { ok: false; error: string } {
  if (!isValidHero(rawHero)) return { ok: false, error: "некорректный профиль пилота" };
  const existing = guestId ? repository.get(guestId) : null;
  if (existing?.heroConfirmed) {
    return {
      ok: true,
      hero: {
        ...rawHero,
        skills: existing.hero.skills,
        startingTyre: existing.hero.startingTyre,
        pitCompound: existing.hero.pitCompound,
      },
    };
  }
  const alloc = validateStartingAllocation(rawHero.skills);
  if (!alloc.ok) return { ok: false, error: "некорректный профиль пилота" };
  return { ok: true, hero: rawHero };
}

// Is this identity (guestId / Yandex sub) already holding a LIVE connection somewhere —
// either queued in the lobby or connected in any room? Excludes the calling connection.
function identityLiveElsewhere(
  guestId: string,
  selfConnectionId: string,
  rooms: Map<string, Room>,
  lobby: Lobby,
): boolean {
  if (lobby.hasLiveGuest(guestId)) {
    return true;
  }
  for (const room of rooms.values()) {
    if (room.hasLiveGuest(guestId)) return true;
  }
  return false;
}

function handle(
  conn: ConnState,
  msg: ClientMessage,
  rooms: Map<string, Room>,
  cleanupRoom: (room: Room | null) => void,
  makeSink: (ws: WebSocket) => RoomSink,
  repository: DriverProfileRepository,
  lobby: Lobby,
  sessionSecret: string,
): void {
  const ws = conn.ws;
  switch (msg.type) {
    case "hello": {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        send(ws, { type: "error", message: `protocol version mismatch, expected ${PROTOCOL_VERSION}` });
        break;
      }
      // Auth resolution: if `authToken` is present and verifies, its `sub` (`yandex:<id>`)
      // overrides the client-sent guestId. Invalid/absent → graceful fallback to guest flow.
      // Never throws across the WS boundary. Note: this is the Yandex auth session token,
      // NOT the room-scoped `sessionToken` used by `reconnect`.
      let resolvedGuestId: string | undefined = msg.guestId;
      if (msg.authToken) {
        const authPayload = verifySessionToken(msg.authToken, sessionSecret);
        if (authPayload) resolvedGuestId = authPayload.sub;
      }
      // S0-1: validate the hero BEFORE tearing down any existing room/queue or touching the
      // profile, so a malformed/god-mode hello can't disrupt an existing session or mutate
      // a confirmed pilot's server-owned skills.
      const heroCheck = validateClientHero(repository, msg.hero, resolvedGuestId);
      if (!heroCheck.ok) {
        send(ws, { type: "error", message: heroCheck.error });
        break;
      }
      const prevRoom = conn.room;
      if (prevRoom) {
        prevRoom.removeConnection(conn.connectionId);
        cleanupRoom(prevRoom);
        conn.room = null;
      } else {
        lobby.dequeue(conn.connectionId);
      }
      // Profile resolution happens here (not in Room) so the lobby can read the player's
      // division for matching. The resolved profile travels with the queue entry and is
      // passed back into Room.addConnection when the lobby assigns a room.
      const resolved = resolveHeroProfile(repository, heroCheck.hero, resolvedGuestId);
      // One live session per identity: block the same account (guestId / Yandex sub) from
      // entering the queue or a room while it already holds a LIVE connection elsewhere
      // (e.g. a second device/tab). Lingering grace-period sockets don't count — reconnect
      // handles those. Ephemeral (no guestId) connections skip the check.
      if (resolved.guestId && identityLiveElsewhere(resolved.guestId, conn.connectionId, rooms, lobby)) {
        send(ws, { type: "error", message: "this account is already in a race — close the other device/tab first" });
        break;
      }
      lobby.enqueue({
        connectionId: conn.connectionId,
        sink: makeSink(ws),
        guestId: resolved.guestId,
        hero: resolved.hero,
        savedProfile: resolved.profile,
        division: divisionOf(resolved.profile),
        enqueuedAt: Date.now(),
      });
      break;
    }
    case "reconnect": {
      // session token format is `${roomId}:${driverId}:${random}` — its first
      // segment is the owning room id (see Room.makeToken). Reconnect bypasses the
      // lobby entirely: the player is re-entering an existing room directly.
      const roomId = msg.sessionToken.split(":")[0];
      const room = roomId ? rooms.get(roomId) ?? null : null;
      if (!room) {
        send(ws, { type: "error", message: "invalid or expired session token" });
        break;
      }
      const result = room.reconnect(conn.connectionId, msg.sessionToken, makeSink(ws));
      if (!result.ok) {
        send(ws, { type: "error", message: result.error });
        break;
      }
      conn.room = room;
      break;
    }
    case "restart":
      applyOrError(ws, conn.room?.restart(conn.connectionId) ?? null);
      break;
    case "speed":
      applyOrError(ws, conn.room?.setSpeed(conn.connectionId, msg.value) ?? null);
      break;
    case "pause":
      applyOrError(ws, conn.room?.setPaused(conn.connectionId, msg.paused) ?? null);
      break;
    case "pit":
      // During the tutorial, control messages go to the TutorialRoom, not a matchmaking Room.
      if (conn.tutorial) conn.tutorial.handleMessage({ type: "pit", compound: msg.compound });
      else applyOrError(ws, conn.room?.requestPit(conn.connectionId, msg.compound) ?? null);
      break;
    case "cancelPit":
      if (conn.tutorial) conn.tutorial.handleMessage({ type: "cancelPit" });
      else applyOrError(ws, conn.room?.cancelPit(conn.connectionId) ?? null);
      break;
    case "hammerTime":
      if (conn.tutorial) conn.tutorial.handleMessage({ type: "hammerTime", mode: msg.mode });
      else applyOrError(ws, conn.room?.requestHammer(conn.connectionId, msg.mode) ?? null);
      break;
    case "setStartingTyre":
      applyOrError(ws, conn.room?.requestSetStartingTyre(conn.connectionId, msg.compound) ?? null);
      break;
    case "setPushLevel":
      applyOrError(ws, conn.room?.requestPushLevel(conn.connectionId, msg.strategy) ?? null);
      break;
    case "startReaction":
      applyOrError(
        ws,
        conn.room?.recordStartReaction(conn.connectionId, msg.clientTimestamp, msg.sequenceId) ?? null,
      );
      break;
    case "startTutorial": {
      // Tutorial is a parallel entry to `hello` (no lobby, solo). Leave any current room/queue.
      const prevRoom = conn.room;
      if (prevRoom) {
        prevRoom.removeConnection(conn.connectionId);
        cleanupRoom(prevRoom);
        conn.room = null;
      } else {
        lobby.dequeue(conn.connectionId);
      }
      if (conn.tutorial) {
        conn.tutorial.stop();
        conn.tutorial = null;
      }
      let resolvedGuestId: string | undefined = msg.guestId;
      if (msg.authToken) {
        const authPayload = verifySessionToken(msg.authToken, sessionSecret);
        if (authPayload) resolvedGuestId = authPayload.sub;
      }
      // S0-1: reject tutorials for profiles that already finished one BEFORE we touch the
      // profile — otherwise a stray startTutorial would mutate a completed pilot's hero.
      const tutorialExisting = resolvedGuestId ? repository.get(resolvedGuestId) : null;
      if (tutorialExisting && tutorialExisting.tutorialCompleted === true) {
        send(ws, { type: "error", message: "tutorial already completed" });
        break;
      }
      // Validate the hero (shape always; allocation only when the profile isn't confirmed —
      // a confirmed pilot keeps server-owned skills even in the tutorial path).
      const heroCheck = validateClientHero(repository, msg.hero, resolvedGuestId);
      if (!heroCheck.ok) {
        send(ws, { type: "error", message: heroCheck.error });
        break;
      }
      const resolved = resolveHeroProfile(repository, heroCheck.hero, resolvedGuestId);
      const tutorial = new TutorialRoom(makeSink(ws), resolved.hero, repository, resolved.profile);
      conn.tutorial = tutorial;
      tutorial.start();
      break;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
