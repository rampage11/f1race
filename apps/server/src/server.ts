import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { Room, resolveHeroProfile, type RoomSink } from "./room.js";
import { Lobby, divisionOf } from "./lobby.js";
import { createRepository, type DriverProfileRepository } from "./persistence/index.js";
import { handleAuthRequest, verifySessionToken, type AuthEnv } from "./auth/index.js";

const DEFAULT_DB_PATH = "./data/f1race.db";

export interface ServerHandle {
  port: number;
  server: Server;
  wss: WebSocketServer;
  // Exposed so tests can drive a matched room via Room.__advanceForTest (reaching a real
  // race takes minutes; the seam reuses production step methods). Not for production callers.
  rooms: Map<string, Room>;
  stop(): Promise<void>;
}

interface ConnState {
  ws: WebSocket;
  connectionId: string;
  room: Room | null;
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

  const server = createServer(async (req, res) => {
    if (await handleAuthRequest(req, res, authEnv)) return;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "f1race-server", status: "ok" }));
  });

  const wss = new WebSocketServer({ server });
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
    room.onEmpty = () => rooms.delete(room.id);
    rooms.set(room.id, room);
    return room;
  };

  const lobby = new Lobby(
    () => registerRoom(new Room(repository)),
    (connId, room) => {
      const c = conns.get(connId);
      if (c) c.room = room;
    },
  );
  lobby.start();

  wss.on("connection", (ws: WebSocket) => {
    const conn: ConnState = { ws, connectionId: randomUUID(), room: null };
    conns.set(conn.connectionId, conn);
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send(ws, { type: "error", message: "invalid json" });
      }
      handle(conn, msg, rooms, cleanupRoom, makeSink, repository, lobby, sessionSecret);
    });
    ws.on("close", () => onConnClosed(conn));
    ws.on("error", () => onConnClosed(conn));
  });

  function onConnClosed(conn: ConnState): void {
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

  return new Promise<ServerHandle>((resolve) => {
    server.listen(port, () => {
      const actual = boundPort(server);
      console.log(`[f1race] WS server on ws://localhost:${actual} (origin ${ALLOWED_ORIGIN}, db ${dbPath})`);
      resolve({
        port: actual,
        server,
        wss,
        rooms,
        stop: () => {
          lobby.stop();
          for (const room of rooms.values()) room.stop();
          rooms.clear();
          for (const c of wss.clients) c.terminate();
          repository.close();
          return Promise.all([
            new Promise<void>((r) => wss.close(() => r())),
            new Promise<void>((r) => server.close(() => r())),
          ]).then(() => undefined);
        },
      });
    });
  });
}

function applyOrError(ws: WebSocket, error: string | null): void {
  if (error) send(ws, { type: "error", message: error });
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
      const prevRoom = conn.room;
      if (prevRoom) {
        prevRoom.removeConnection(conn.connectionId);
        cleanupRoom(prevRoom);
        conn.room = null;
      } else {
        lobby.dequeue(conn.connectionId);
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
      // Profile resolution happens here (not in Room) so the lobby can read the player's
      // division for matching. The resolved profile travels with the queue entry and is
      // passed back into Room.addConnection when the lobby assigns a room.
      const resolved = resolveHeroProfile(repository, msg.hero, resolvedGuestId);
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
      applyOrError(ws, conn.room?.requestPit(conn.connectionId, msg.compound) ?? null);
      break;
    case "cancelPit":
      applyOrError(ws, conn.room?.cancelPit(conn.connectionId) ?? null);
      break;
    case "startReaction":
      applyOrError(
        ws,
        conn.room?.recordStartReaction(conn.connectionId, msg.clientTimestamp, msg.sequenceId) ?? null,
      );
      break;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
