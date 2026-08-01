import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import { GameSession } from "./session.js";

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

interface ConnState {
  ws: WebSocket;
  session: GameSession | null;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ service: "f1race-server", status: "ok" }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket) => {
  const conn: ConnState = { ws, session: null };
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return send(ws, { type: "error", message: "invalid json" });
    }
    handle(conn, msg);
  });
  ws.on("close", () => {
    conn.session?.stop();
    conn.session = null;
  });
  ws.on("error", () => {
    conn.session?.stop();
  });
});

function handle(conn: ConnState, msg: ClientMessage): void {
  const ws = conn.ws;
  switch (msg.type) {
    case "hello": {
      conn.session?.stop();
      const session = new GameSession(msg.hero, (m) => send(ws, m));
      conn.session = session;
      break;
    }
    case "restart":
      conn.session?.restart();
      break;
    case "speed":
      conn.session?.setSpeed(msg.value);
      break;
    case "pause":
      conn.session?.setPaused(msg.paused);
      break;
    case "pit":
      conn.session?.requestPit(msg.compound);
      break;
  }
}

server.listen(PORT, () => {
  console.log(`[f1race] WS server on ws://localhost:${PORT} (origin ${ALLOWED_ORIGIN})`);
});
