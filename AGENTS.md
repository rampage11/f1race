# AGENTS.md

Compact guide for OpenCode sessions working in this repo. Read before running/editing.

## Layout (pnpm workspace)

- `packages/race-engine` — pure TS simulation library (no DOM/Node I/O). `RaceEngine` (race) + `QualifyingEngine` (qualifying). **All formulas/balance live in `src/config.ts`** — this is the single tuning surface.
- `apps/server` — Node + WebSocket. Authoritative: runs qualy → startSequence (Phase 2 lights-out mini-game) → race, broadcasts `snapshot()`, accepts `hello`/`reconnect`/`pit`/`cancelPit`/`speed`/`pause`/`restart`/`startReaction`. WS message types live in `src/protocol.ts`; the room loop is `Room` in `src/room.ts` (multi-connection: N clients share one room, broadcast + per-connection `driverId` ownership, session tokens for reconnection, `mode: solo|multiplayer` gating, per-connection rate limits); `Lobby` in `src/lobby.ts` (Phase 4) owns the matchmaking queue + tick, grouping queued players by `division` into `Room`s and backfilling with bots.
- `apps/web` — Vite + React + Canvas. Renders snapshots only. **No game logic belongs here** (online/anti-cheat invariant).

## Install gotcha (esbuild) — read this

`pnpm install` leaves esbuild's postinstall blocked → `ERR_PNPM_IGNORED_BUILDS` makes `pnpm install` and `pnpm <script>` wrappers return non-zero. `pnpm-workspace.yaml` carries an `allowBuilds.esbuild` toggle (and `onlyBuiltDependencies`); `.npmrc` has `verify-deps-before-run=false`. If scripts still exit non-zero, either set `allowBuilds.esbuild: true` in `pnpm-workspace.yaml` or just:

```
pnpm rebuild esbuild        # do this once
```

`better-sqlite3` is a native module too — it's already allow-listed in `pnpm-workspace.yaml` (`allowBuilds.better-sqlite3: true` + `onlyBuiltDependencies`), so `pnpm install` builds it from source (needs a C++ toolchain). Requires `better-sqlite3@13+` for Node 26 (no prebuilt binary; v11 fails to compile against Node 26's V8). If the native binding fails to load, `pnpm rebuild better-sqlite3`.

## Running it (two terminals)

```
pnpm --filter @f1race/race-engine build   # REQUIRED before server: it imports the engine via package exports -> dist/
pnpm --filter @f1race/server dev          # ws://localhost:8787
pnpm --filter @f1race/web dev             # http://localhost:5173
```

- Always invoke dev scripts via `pnpm --filter <pkg> <script>` (runs in the package dir). The web `dev` script is bare `vite`; running `vite` from repo root 404s because `index.html` lives in `apps/web`.
- WS URL configurable via `VITE_WS_URL` (default `ws://localhost:8787`).

## Binaries are per-package, not at root

pnpm does not hoist `tsx`/`vitest`/`vite` to root `node_modules/.bin`. If `pnpm` wrappers misbehave, call the binary from the package, e.g. `apps/server/node_modules/.bin/tsx`, `packages/race-engine/node_modules/.bin/vitest`, or use `pnpm exec`.

## Typecheck / test

```
pnpm --filter @f1race/race-engine typecheck
pnpm --filter @f1race/race-engine test            # vitest run
pnpm --filter @f1race/race-engine test -- <pattern>   # single test file/name
pnpm --filter @f1race/server typecheck
pnpm --filter @f1race/server test                 # vitest run (WS integration + Room unit)
```

Engine has **48** vitest tests (race + qualifying + determinism + P19b pit-result status + xp/level progression). Server has **82** vitest tests (lobby matchmaking + WS integration + Room unit + persistence + **Yandex OAuth + session tokens**). No tests for web yet. No lint is configured (script is a no-op echo).

## TypeScript strictness that will bite you

`tsconfig.base.json` enables `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. In `race-engine` especially:

- Use `import type` for type-only imports.
- Never assign `undefined` to an optional field inline — build the object, then set the field conditionally. (Web/server tsconfigs relax `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.)
- Indexing an array returns `T | undefined`; guard it.

## Tuning gameplay

Edit `packages/race-engine/src/config.ts`, then validate with a harness (keep seed count low — each run executes full races and gets slow):

```
pnpm --filter @f1race/race-engine sim          # one race, printed grid + result
pnpm --filter @f1race/race-engine sim:grid     # compare hero builds
tsx packages/race-engine/scripts/balance.ts    # avg finishing place across builds/seeds
tsx packages/race-engine/scripts/spread.ts     # P1→P20 time spread + neighbor gaps (balance of field)
tsx packages/race-engine/scripts/stretch.ts    # how the field spreads lap-by-lap (start "blob" debugging)
```

Spread of the field (no bunched pack, no giant mid-field holes) is tuned via per-driver `paceFactor` and `launchFactor` in `packages/race-engine/src/factory.ts` (gaussian, clamped). Goalpost: no single hero build or tyre combo is auto-win/auto-loss. `recommendedLaps(track)` derives lap count from a target race distance (not hardcoded).

## Conventions

- Comments: none in code unless a non-obvious formula/physics reason — keep it that way.
- Engine dt = 0.1s; server ticks ~10×/s. In `solo` mode a tick advances `speed × tick` sim-steps; in `multiplayer` mode (`activeConnectionCount >= 2`) the tick is locked to real-time (1 step/tick) and client `speed`/`pause` are rejected.
- Reconnection: on disconnect a driver's slot (and car) is kept for `GRACE_PERIOD_MS` (default 30s, env-overridable for tests); `reconnect { sessionToken }` rebinds a new socket to the same driver. After grace the connection is evicted but the car keeps racing as an unowned ghost.
- No git remote, no CI, no migrations/codegen.

## Multiplayer protocol contract (Phase 1)

`apps/server/src/protocol.ts` is the canonical source. Current shape:

- `ClientMessage`: `hello { protocolVersion, hero, guestId?, authToken? }` (`guestId` = optional client UUID for persistence; absent → ephemeral. `authToken` = OPTIONAL Yandex OAuth session token issued by `POST /auth/yandex/callback` — when present AND valid it OVERRIDES `guestId`: the profile resolves by its `sub` (`yandex:<id>`); invalid/absent → graceful guest fallback. **`authToken` (Yandex identity) ≠ `sessionToken` in `reconnect`** (room-scoped reconnection).) | `reconnect { sessionToken }` | `restart` | `speed { value }` | `pause { paused }` | `pit { compound }` | `cancelPit` | `startReaction { clientTimestamp, sequenceId }` (Phase 2 lights-out mini-game; `clientTimestamp` is UX-only, fairness uses the server receipt time).
- `ServerMessage`: `welcome { driverId, sessionToken, mode, profile? }` (**Phase 4: now DEFERRED until the lobby matches the player; `profile: DriverProfileSummary` present only when a persisted profile was loaded/created. `welcome` is the lobby→room match signal — there is no separate "matched" message. It is also sent on `reconnect`, which bypasses the lobby.**) | `lobbyState { division, queuedPlayers, estimatedWaitSec }` (Phase 4: unicast to a queued player on enqueue and on each match tick while they wait; `queuedPlayers` = humans currently waiting in the same division as the player) | `stage { stage }` | `snapshot { stage, snapshot, heroId }` | `result { result, heroId }` | `progression { xpGained, totalXp, level, xpIntoLevel, xpForNext, division, racesCount }` (unicast to each human connection with a profile, right after their `result` on finish — Phase 3) | `roomState { players, mode }` | `startSequence { lightsOutAt, sequenceId }` (broadcast when the lights-out sequence begins; `lightsOutAt` is a server wall-clock ms timestamp) | `startResult { driverId, reactionSec, jumpStart }` (unicast per player after resolution) | `error { message }`.
- `DriverProfileSummary = { guestId, hero: PilotProfile, level, division: Division, totalXp, racesCount }` (sent inside `welcome`).
- `Division = "F4" | "F3" | "F2" | "F1"` (exported from `protocol.ts`; by level range: F4 1-9, F3 10-19, F2 20-34, F1 35+). **Phase 4 matches by `division`** (derived from `level`): the lobby groups queued players by division into rooms and backfills with bots. Spec open-question Q5 (`skillSum` vs `level`) is moot for now — `skillSum` is constant 10 for all new characters (trainings don't exist yet), so `level`/`division` is the only varying signal. This decision reopens when trainings land.
- Phase 3 persistence: profiles (SQLite via `better-sqlite3`, behind `DriverProfileRepository`) keyed by `guestId`; **profile resolution happens in the `hello` handler** (`resolveHeroProfile` exported from `room.ts`) so the lobby can read the player's `division` for matching — `Room.addConnection` accepts an already-resolved profile (5th `resolved?: ResolvedProfile` arg) and skips internal resolution when provided. Stored on `hello` (load/create) and on race finish (`xpForRace` + `levelFromXp`/`divisionForLevel`, one transaction = upsert profile + add race_history row). DB path = env `DB_PATH` (default `./data/f1race.db`, WAL + synchronous=NORMAL); `apps/server/data/` is gitignored. No guestId → ephemeral (everything works, nothing persists).
- **Phase 3 Yandex OAuth** (`apps/server/src/auth/`): authorization-code flow implemented directly in Node (NOT Supabase like align360). Routes are added to the existing `createServer` HTTP handler in `server.ts` (extended; no Express). `handleAuthRequest(req, res, env)` returns `true` when handled (auth route), `false` → falls through to the default health JSON. Routes:
  - `OPTIONS *` → 204 with CORS headers (`Access-Control-Allow-Origin` from env `ALLOWED_ORIGIN`, default `*`; allow-headers `content-type, authorization`; allow-methods `GET, POST, OPTIONS`).
  - `POST /auth/yandex/callback` — JSON body `{ code: string, redirectUri: string }`. Validates presence → token exchange (`POST https://oauth.yandex.ru/token`, `application/x-www-form-urlencoded`, body has `grant_type=authorization_code & code & client_id & client_secret & redirect_uri`) → user info (`GET https://login.yandex.ru/info?format=json`, header `Authorization: OAuth <access_token>`). Profile key = `yandex:<id>`, loaded/created via `DriverProfileRepository` (reuses the same table; no schema change). Brand-new user gets `DEFAULT_YANDEX_HERO` (`apps/server/src/auth/yandex.ts` — mirrors `apps/web/src/race/SetupScreen.tsx` `DEFAULTS`; **keep them in sync**). Issues a stateless **session token** (HMAC-SHA256, see below) and responds `200 { sessionToken, profileSummary: DriverProfileSummary, isNewUser }`. Token-exchange failure → 502 `{ error }`; missing fields → 400; Yandex creds unset → 503 `{ error: "yandex oauth not configured" }`.
  - `GET /auth/me` (optional convenience) — `Authorization: Bearer <sessionToken>` → returns the `DriverProfileSummary`. Missing/invalid token → 401; profile gone → 404; `SESSION_SECRET` unset → 503.
- **Session token format** (`apps/server/src/auth/session.ts`): `base64url(payloadJson) + "." + base64url(hmac)`, where payload = `{ sub: "yandex:<id>", iat: Date.now() }` and hmac = `HMAC-SHA256(SESSION_SECRET, base64url(payloadJson))`. Stateless, no DB lookup to verify. Constant-time compare via `crypto.timingSafeEqual`. `verifySessionToken(token, secret)` returns `{ sub, iat } | null` (never throws — WS hello handler falls back to guest on null). Returns null when `secret` is empty (auth disabled).
- **Auth env vars** (graceful degradation when unset):
  - `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` — from https://oauth.yandex.ru/client/new (scopes `login:email login:info`, redirect URIs include `http://localhost:5173/yandex-callback` for dev + prod `https://<domain>/yandex-callback`). NEVER sent to the client; used only in the `/auth/yandex/callback` exchange. State-param CSRF is handled CLIENT-side (mirrors align360's `sessionStorage` state); the server exchanges whatever code it receives.
  - `SESSION_SECRET` — random string for HMAC. If Yandex creds are set but this is unset → `startServer()` throws. If unset AND no Yandex creds → server boots, `/auth/yandex/callback` returns 503, WS runs in pure-guest mode.
  - `ALLOWED_ORIGIN` — already existed; reused for CORS on auth responses (default `*`). WS does not need CORS.
  - `PUBLIC_BASE_URL` — canonical origin (optional); not currently used since the client sends `redirectUri` explicitly.
- `Stage = "qualy" | "startSequence" | "race" | "finished"`. `"startSequence"` (Phase 2) sits between qualy and race: qualy finished, the lights-out reaction window is open, the `RaceEngine` is not yet built. Reconnecting players are re-sent the current `startSequence`.
- `RoomMode = "solo" | "multiplayer"`, derived live from `activeConnectionCount >= 2`; exposed in `welcome` and `roomState`.
- Commands that can't apply return `{ type: "error", message }` rather than no-op (pit outside race, same-compound pit, multiplayer speed/pause, rate-limit hits). Rate limits (per connection): `pit`/`cancelPit` 1500ms, `restart` 10s, `pause`/`speed` 500ms.
- **Phase 4 lobby** (`src/lobby.ts`): `Lobby` owns a queue of `{ connectionId, sink, guestId, hero, savedProfile, division, enqueuedAt }` entries and a matchmaking tick. Tuning constants (env-overridable): `MATCH_TICK_MS` (default 30000 — spec Фаза 4 "тик 30с"), `SOLO_WAIT_MS` (default 2000 — a lone player past this with no same-division company matches into their own bot-filled room), `MAX_WAIT_MS` (default 60000 — widener: a player past this matches into ANY division rather than waiting forever). `enqueue()` sends `lobbyState` and runs an immediate group-only pass (≥2 same-division humans → same room); solo fast-start fires on the tick. Tests set `MATCH_TICK_MS=50`, `SOLO_WAIT_MS=0`, `MAX_WAIT_MS=1000` (in `tests/helpers.ts`) so a lone player matches within ~one tick. `Room.__advanceForTest({ stopAtRace? })` is a test-only seam that drives a room synchronously to race/finish (reaching a real race takes minutes); it reuses the same private step methods the production tick uses.

## Capacity baseline

`pnpm --filter @f1race/server load-baseline` — measures per-tick wall-clock and RSS across 1/10/50/100 rooms (2 conns each, multiplayer pacing). Findings in `docs/load-baseline.md`: ~0.033 ms/room race-tick, 100 rooms = 3.3 ms/frame (of a 100 ms budget) → single-process + periodic Redis snapshot (P10) is adequate through hundreds of rooms; no worker isolation needed for Фазы 1–4.

## Production (f1-race.ru)

Self-hosted on the same Yandex Cloud VM as align360 (`93.77.183.135`, instance `fhmak6g020dm1gpgnnkm` / kart-technic; SSH user `mike`, `ssh -i ~/.ssh/id_ed25519 mike@93.77.183.135` or `yc compute ssh --id fhmak6g020dm1gpgnnkm`). Domain `f1-race.ru` (reg.ru NS, A-record → VM).

Layout on the VM:
- `/opt/f1race` — source (uploaded; no `.git`, no `node_modules` on first upload). `pnpm install` runs on the VM under **Node 22 via nvm** (`/home/mike/.nvm/versions/node/v22.23.2/`) — do NOT use system `/usr/bin/node` (v20, used by other services: island, plannav). pnpm via corepack (the repo pins `packageManager: pnpm@11.1.2` which needs Node ≥22). `better-sqlite3` compiles from source on Node 22 (toolchain present: python3/make/g++); `pnpm rebuild esbuild` may be needed.
- `/opt/f1race/.env` (chmod 600) — `PORT=8787`, `DB_PATH=/opt/f1race/data/f1race.db`, `ALLOWED_ORIGIN=https://f1-race.ru`, `NODE_ENV=production`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, `SESSION_SECRET` (openssl rand -hex 32). Yandex creds unset → `/auth/yandex/callback` returns 503, server runs pure-guest.
- `/opt/f1race/data/f1race.db` — SQLite (WAL), gitignored.
- systemd `f1race.service` (`/etc/systemd/system/f1race.service`) runs as `mike`: `ExecStart=<nvm-node> /opt/f1race/apps/server/node_modules/tsx/dist/cli.mjs src/server.ts` with `WorkingDirectory=/opt/f1race/apps/server`. `sudo systemctl {status,restart,stop} f1race`; logs via `sudo journalctl -u f1race -f`. Binds `0.0.0.0:8787`.
- `/var/www/f1race` — static web build (Vite, built locally with prod env, uploaded via tar).
- nginx: docker container `kart-technic-nginx-1` (defined in `/opt/kart-technic/docker-compose.yaml`, binds host 80/443). Config `/opt/kart-technic/nginx/nginx.conf` has the `f1-race.ru` server block: HTTP→HTTPS redirect (+ `/.well-known/acme-challenge/` webroot), HTTPS serves `/var/www/f1race` static + `proxy_pass http://172.18.0.1:8787` for `/ws` (WebSocket upgrade) and `/auth/`. `172.18.0.1` = docker bridge gateway → host (the nginx container reaches the host systemd service this way). The `/var/www/f1race` dir is volume-mounted into the container (`docker-compose.yaml` nginx volumes). Backups: `nginx.conf.bak-*`, `nginx.conf.pre-ssl.bak-*`.
- SSL: Let's Encrypt via certbot (webroot `/var/www/f1race`), certs in `/etc/letsencrypt/live/f1-race.ru/` (mounted ro into nginx container). Renewal: standard certbot timer. After editing `nginx.conf`: `sudo docker exec kart-technic-nginx-1 nginx -t && sudo docker exec kart-technic-nginx-1 nginx -s reload`.
- **IMPORTANT** (shared box): the host apt-nginx MUST stay disabled (`sudo systemctl disable nginx`) — the docker nginx squats 80/443. Disk is tight (~92%): freed 1.9G via `journalctl --vacuum-size`; before large ops check `df -h /`. Don't prune actively-used docker images (all are live).

Redeploy server:
```bash
tar czf /tmp/f1race-src.tar.gz --exclude=node_modules --exclude=.git --exclude=dist --exclude='apps/server/data' --exclude='*.tsbuildinfo' -C /Users/mike/Developer/f1race .
cat /tmp/f1race-src.tar.gz | ssh -i ~/.ssh/id_ed25519 mike@93.77.183.135 'cd /opt/f1race && tar xzf -'
ssh ... 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd /opt/f1race && pnpm install --frozen-lockfile && pnpm --filter @f1race/race-engine build && sudo systemctl restart f1race'
```
Redeploy web (build locally with prod env, ship the tarball — no node needed on the VM for static):
```bash
VITE_WS_URL="wss://f1-race.ru/ws" VITE_YANDEX_CLIENT_ID="<id>" pnpm --filter @f1race/web build
tar czf /tmp/f1race-web.tar.gz -C apps/web/dist .
cat /tmp/f1race-web.tar.gz | ssh ... 'rm -rf /var/www/f1race/* && tar xzf - -C /var/www/f1race'
```
If a brand-new env var or port change: edit `/opt/f1race/.env` then `sudo systemctl restart f1race`. If touching `docker-compose.yaml` nginx volumes: `cd /opt/kart-technic && sudo docker compose up -d nginx` (brief blip for ALL sites on that nginx).
