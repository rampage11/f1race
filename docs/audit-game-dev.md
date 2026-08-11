# F1 Race Game — Production-Readiness Audit (Game Developer Agent)

## 1. BUGS

### CRITICAL

#### B1. WS `hello` path accepts arbitrary hero with zero validation — anti-cheat bypass
**Category:** bug / arch / security
**Location:** `apps/server/src/server.ts:221`, `apps/server/src/room.ts:150`

The WebSocket `hello` handler passes `msg.hero` directly to `resolveHeroProfile`, which **overwrites the stored profile's hero without any validation**:
```ts
// room.ts:150
existing.hero = hero;  // client-supplied, unvalidated
repository.upsert(existing);
```
The HTTP `/api/profile/confirm` path validates with `isValidHero()` + `validateStartingAllocation()`, but the WS `hello` path does **none of this**. A client can send `{type:"hello", hero:{skills:{pace:999,attack:999,...}, name:"...", ...}}` and race with god-mode skills. The same gap exists in `startTutorial` (`server.ts:309`).

This is the single most critical finding — it completely defeats the "authoritative server" invariant documented in AGENTS.md.

**Fix:** Validate `msg.hero` (shape + skill bounds + starting allocation) in the WS `hello`/`startTutorial` handlers before calling `resolveHeroProfile`. For confirmed profiles, reject skill changes entirely (only allow cosmetic fields: name/team/country). For unconfirmed profiles, run `validateStartingAllocation`.

#### B2. `pit` compound and `hammerTime` mode not validated at runtime — crash on invalid input
**Category:** bug / security
**Location:** `apps/server/src/server.ts:270-279`, `apps/server/src/room.ts:457-501`, `packages/race-engine/src/engine.ts:197-228`

`msg.compound` and `msg.mode` are trusted as `TyreCompound`/`HammerMode` at the type level but **never validated at the runtime boundary**. JSON.parse produces untyped data; the `as ClientMessage` cast is a lie. A client sending `{type:"pit", compound:"HACK"}` stores it in `pitRequests`; when the pit fires, `freshTyre("HACK")` creates an invalid tyre, and the next `CONFIG.tyres["HACK"].cliff` access crashes the room loop. Similarly, `{type:"hammerTime", mode:"X"}` makes `CONFIG.HAMMER_TIME.mode["X"]` undefined → `.cornering` throws.

`setStartingTyre` correctly validates (`VALID_COMPOUNDS.has(compound)`), but `pit` and `hammerTime` don't.

**Fix:** Add `VALID_COMPOUNDS` and a `VALID_MODES` set check in `Room.requestPit` / `Room.requestHammer` before forwarding to the engine.

#### B3. `speed` value not type-validated — NaN soft-bricks the room
**Category:** bug
**Location:** `apps/server/src/room.ts:445`

```ts
this.speed = Math.max(1, Math.min(30, Math.round(value)));
```
If `value` is a string/null (malicious client), `Math.round("abc")` = `NaN`, and `Math.max(1, NaN)` = `NaN`. Then in `tick()`: `steps = Math.max(1, Math.round(NaN))` = `NaN`, and `while (NaN-- > 0)` is immediately false — **the race stops advancing**. The room is soft-bricked with no error to the player.

**Fix:** `if (typeof value !== "number" || !Number.isFinite(value)) return "invalid speed";` before the clamp.

#### B4. DSQ/penalty info events never emitted — players penalized with no explanation
**Category:** bug
**Location:** `packages/race-engine/src/engine.ts:670-673`

`finishRace()` sets `c.finishPlace = i + 1` for **every** car before `result()` is called. So `c.finishPlace == null` is always `false`. The DSQ and 30s-penalty info messages are **dead code** — they never appear in the events feed. A player who forgets to pit gets DSQ'd with zero in-game explanation.

**Fix:** Remove the `c.finishPlace == null` guard (it's the wrong condition). Emit the events based on `noStop` / `wrongCompound` alone.

#### B5. `positionsGained` computed from pre-penalty finishing order — wrong XP
**Category:** bug
**Location:** `packages/race-engine/src/engine.ts:687`

`c.finishPlace` is the **on-track** finishing order (set by `finishRace` before penalties). Then `result()` applies DSQ/30s penalties and re-sorts, overwriting `r.place`. But `positionsGained` still uses the pre-penalty `c.finishPlace`. A player who crosses the line P3 but gets a 30s same-compound penalty dropping them to P8 still reports `positionsGained` based on P3 — granting unearned `positionsGainedBonus` XP.

**Fix:** Compute `positionsGained` from the final post-re-sort `r.place`. Move the `positionsGained` assignment into the `rows.forEach((r, i) => ...)` loop after re-sorting.

#### B6. No graceful shutdown (SIGTERM/SIGINT handlers missing)
**Category:** prod / bug
**Location:** `apps/server/src/server.ts`

There are no `process.on("SIGTERM", ...)` / `SIGINT` handlers. When systemd restarts the service, the process is killed without flushing in-flight DB transactions or closing WebSocket connections cleanly. Active races are silently dropped.

**Fix:** Register `SIGTERM`/`SIGINT` handlers that call the `stop()` logic with a timeout fallback to `process.exit(0)`.

### MEDIUM

#### B7. Tyre grip discontinuity at cliff boundary — +3% grip jump
**Category:** bug
**Location:** `packages/race-engine/src/tyres.ts:22`

Grip **jumps up 3%** at the exact cliff boundary (from `gripFresh * 0.970` to `gripFresh * 1.0`), then drops steeply. Crossing into the "cliff" gives a momentary grip boost — physically wrong.

**Fix:** Make the cliff branch continuous: `base = gripFresh * 0.97 * (1 - 0.35 * ...)`.

#### B8. Telemetry "leader gap" is dead code — always shows "—"
**Category:** bug / UX
**Location:** `apps/web/src/race/Telemetry.tsx:38-39`

Both branches return "—". The snapshot doesn't carry a gap-to-leader field.

**Fix:** Compute gap-to-leader from the standings or remove the element.

#### B9. `formatGap` uses 60 seconds = 1 lap — wrong for real lap times
**Category:** bug / text
**Location:** `apps/web/src/race/colors.ts:51`

Red Bull Ring laps are ~75s, Monza ~95s. A 60-second gap shows "+1.0l" but is actually less than a lap.

**Fix:** Compute `gapInLaps = sec / lapTime`, or show large gaps as `+MmSS`.

### LOW

#### B10. TutorialRoom duplicates level calculation
**Location:** `apps/server/src/tutorial-room.ts:186-194`

Duplicates `progressFromXp` logic. Extract to a shared util.

## 2. PERFORMANCE

#### P1. Full events array resent every snapshot (10×/sec) — unused by client
**Location:** `packages/race-engine/src/engine.ts:752`, `apps/server/src/room.ts:977`

`snapshot()` returns `events: this.events` — the **monotonically growing** internal array, by reference. Broadcast 10×/sec. The client never reads `events`. ~16-50KB/s per client wasted.

**Fix:** Remove `events` from `RaceSnapshot` entirely (dead data) OR delta-encode.

#### P2. `standings` minimap recomputes track geometry every snapshot
**Location:** `apps/web/src/race/Standings.tsx:10-36`

`useMemo` deps include `snapshot.cars` (new every tick) → track geometry recomputed 10×/sec.

**Fix:** Split into two memos: track geometry (dep `[trackId]`), car dots (dep `[cars, heroId]`).

#### P3. `lookaheadSpeed` does 20 linear-scan `segmentAtS` calls per car per step
**Location:** `packages/race-engine/src/engine.ts:338-352`

Precompute `segmentBoundaries: number[]` and binary-search. ~10× faster. Not urgent.

#### P4. Snapshot `cars` array rebuilt + re-sorted every tick
Object pooling / flat array if profiling shows GC pressure. Not urgent at current scale.

## 3. ARCHITECTURE / CODE QUALITY

#### A1. Authoritative server trusts client-supplied hero/skills (see B1)
#### A2. Engine `events` array returned by reference in both `snapshot()` and `result()`
Return `[...this.events]` or a readonly snapshot with event sequencing.
#### A3. `resolveHeroProfile` writes on every hello
Separate "load profile" from "update cosmetic fields". Only accept name/team/country from the client.
#### A4. Room has test-only seams mixed into production code
Move `__advanceForTest` etc. to a `TestRoom extends Room` subclass.
#### A5. No input size validation on WebSocket messages
Set explicit `maxPayload`, validate string field lengths (name ≤ 32 chars).

## 4. GAME BALANCE

#### G1. Qualifying doesn't model weather — rain-race grids are inverted
**Location:** `packages/race-engine/src/qualifying-engine.ts:167-175`, `apps/server/src/room.ts:686-694`

`QualifyingEngine` doesn't receive or apply weather. Bots' `startingTyre` is wet/intermediate in rain but quali uses dry pace → grid doesn't reflect race conditions.

**Fix:** Pass `weather` to `QualifyingEngine` and forward to `paceSpeedMultiplier`.

#### G2. Hammer Time "push" mode ×1.30 cornering may be overpowered
**Location:** `packages/race-engine/src/config.ts:195`

Run `pnpm sim:grid` comparing "push spam" vs "no hammer" hero. Reduce to ×1.15-1.20 or increase tyreWear to ×4.0 if push spam wins.

#### G3. Bot rival `skillBudget` bonus (+10) may be too strong in F4
**Location:** `packages/race-engine/src/config.ts:245`

Reduce `rivalBonus` to 5-6 for F4, scaling up for higher divisions. Or cap rival budget at `playerMax × 1.5`.

#### G4. Same-compound 30s penalty is near-auto-loss
Consider the casual-game impact — may feel too punishing.

## 5. PRODUCTION READINESS

#### PR1. No DB backup strategy (HIGH)
Add daily cron: `sqlite3 ... ".backup ..."` + off-site copy. Schedule `PRAGMA wal_checkpoint(TRUNCATE)`.

#### PR2. No structured logging or metrics (MEDIUM)
Add pino/JSON logger. Emit periodic metrics `{rooms, connections, avgTickMs}`.

#### PR3. Health check doesn't verify DB or room state (MEDIUM)
Add real `/health`: DB readable, lobby timer running, return 503 if DB unreachable.

#### PR4. No HTTP rate limiting on auth/API routes (MEDIUM)
Token bucket per IP for auth (10/min) and API (60/min).

#### PR5. In-memory room state lost on restart (MEDIUM)
Serialize room state to Redis. For now, broadcast "server restarting" before shutdown.

## 6. TEXTS / UX WRITING

#### T1. "срочно питься!" — grammatical error (HIGH)
`apps/web/src/race/PitPanel.tsx:49` — "питься" is wrong. → `"срочно на пит-стоп!"`

#### T2. Inconsistent "variable" weather labels (MEDIUM)
`"Перемен."` / `"Переменная"` / `"Переменная облачность"` across screens. Pick one.

#### T3. English strings in Russian UI (MEDIUM)
`"PERFECT START"`, `"LEVEL UP!"`, `"GO!"`, `"LAP 5/12"` — localize.

#### T4. HubScreen building names don't match their trained skill (MEDIUM)
"Медиа-центр" trains Defense — confusing. Align names or make skill the primary badge.

## Summary: Priority Matrix

| Priority | Finding | Category |
|----------|---------|----------|
| **P0** | B1: WS hello accepts arbitrary skills (anti-cheat) | security |
| **P0** | B2: pit compound / hammer mode not validated (crash) | security |
| **P0** | B6: No graceful shutdown | prod |
| **P1** | B3: speed NaN soft-bricks room | bug |
| **P1** | B4: DSQ/penalty events never shown | bug |
| **P1** | B5: positionsGained wrong for penalized cars | bug |
| **P1** | T1: "срочно питься!" grammar | text |
| **P1** | PR1: No DB backups | prod |
| **P2** | P1: Events resent 10×/sec (unused) | perf |
| **P2** | G1: Qualifying ignores weather | balance |
| **P2** | A3: resolveHeroProfile writes on every hello | arch |
| **P2** | PR2-4: Logging, health check, rate limiting | prod |
| **P3** | B7: Tyre grip discontinuity at cliff | bug |
| **P3** | T2-T4: Localization consistency | text |
| **P3** | G2-G3: Hammer Time / rival balance tuning | balance |
