# F1 Race — Reconciled Implementation Spec (Phase 2)

Engineering validation of the Game-Design-Critic (`audit-gamer.md`) recommendations against the
Game-Developer audit (`audit-game-dev.md`) and the live codebase, then a single merged sprint plan.

All file:line references were verified against the current source. Constraints from `AGENTS.md`
honored: web client has no game logic; engine is deterministic with seeded RNG; engine tsconfig is
`exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`; no comments in
code unless a non-obvious formula reason; `import type` for type-only engine imports.

---

## PART 1 — Gamer recommendations: engineering feasibility verdict

### Audio (engine RPM / tyre squeal / DRS beep / Hammer stab / pit limiter)
**FEASIBLE-NOW · effort M · pure client.** All triggers already exist in `RaceSnapshot`:
`CarSnapshot.v` (engine.ts:720), `hammerTime.active` (735), `drsActive` (741), `inPits` (723),
`tyreCompound`/`tyreWear` (721-722). Implement a Web Audio graph in a new
`apps/web/src/race/audio.ts` (engine sample looped/pitch-shifted by `hero.v`, one-shot buffers for
DRS/hammer/pit-limiter). No engine or server change; nothing authoritative about it.

### Hero-cam zoom/follow
**FEASIBLE-NOW · effort M · pure client.** Canvas transform in `apps/web/src/race/TrackCanvas.tsx`.
`heroId` + `sFraction` (engine.ts:719) give position; `pathPointAt()` (already imported from engine
for geometry only — no physics) maps to x/y. Apply `ctx.translate/scale` around hero when toggle on.
Toggle is UX-only (no protocol).

### Push-level toggle (Conserve / Balanced / Attack)
**FEASIBLE-MEDIUM · effort M — but INVARIANT CONFLICT, needs sign-off.**
The engine already models it: multiplier set at `config.ts:46`, `car.pushLevel` field at
`types.ts:80`, hardcoded to `PUSH_BALANCED` at `engine.ts:136`, consumed at `engine.ts:256-263`, and
an unused `pushLevelFor(strategy)` helper at `formula.ts:161`. So wiring player control is small:
new `RaceEngine.requestPushLevel(driverId, lvl)`, new `setPushLevel` client message, a `Room` handler,
a per-driver stored intent re-applied on each step (and reset to balanced on fresh-tyre pit exit).
**The conflict:** `AGENTS.md` explicitly says *"no throttle/brake input … no Defend/Dive/Push/ERS/
motor-mode buttons — explicitly out of scope."* A real-time toggle spammed mid-corner violates the
spirit of "no real-time driving input."

**Reconciliation decision:** implement it as a **per-stint commitment**, NOT a real-time toggle. The
player picks Conserve/Balanced/Attack for the *next stint* when committing a pit stop (alongside the
compound), and at race start. It locks until the next stop. That is a *strategic* input (same
category as compound choice and Hammer mode), not driving input. Requires amending the `AGENTS.md`
wording from "no Push buttons" to "no *real-time* push toggle; per-stint push-level commitment is a
strategic input." If that sign-off is denied, **drop it** — the Hammer Time `push` mode
(`config.ts:195`) already covers burst-pace agency. Do NOT ship a mid-race free toggle.

### Forced weather-change pit prompts
**FEASIBLE-NOW · effort S · pure client.** `effectiveWeather` is already in every snapshot
(engine.ts:755; types.ts:235). Client tracks the previous value in `useRaceSession.ts`; on a
dry→rain transition show a dismissible "Смените резину?" overlay. This is a *prompt*, not an auto-pit
— the player still sends `{type:"pit", compound}` themselves (invariant preserved). Independent of
Dev's G1 quali-weather fix.

### Daily quests · weekly seasons · unlock track · stats screen · streak bonus
Mixed — broken out:

- **Stats screen — FEASIBLE-NOW · effort M.** `race_history` table already exists
  (sqlite-repository.ts:139-150) with place/grid/positionsGained/xpGained/dnf. Add a `GET /api/stats`
  route (read-only aggregate) + `apps/web/src/StatsScreen.tsx`. No schema change.
- **Streak bonus — FEASIBLE-MEDIUM · effort S.** Two new columns on `profiles`
  (`lastRaceDay INTEGER`, `streakDays INTEGER`, idempotent `ALTER TABLE` per existing pattern at
  sqlite-repository.ts:164-189) + XP multiplier in `room.applyProgression`.
- **Daily quests — FEASIBLE-MEDIUM · effort L.** New `quests` table (`profileId, questDefId,
  assignedAt, progress, claimedAt`), assignment on first `/api/*` hit of a UTC day, progress hooks in
  race-finish (`room.applyProgression`) + training-complete. New `/api/quests/*` routes in
  `api/http.ts`. Quest definitions as a static catalog (3/day from a pool). Reuses the lazy-completion
  pattern already in `/api/training/state`.
- **Weekly seasons — FEASIBLE-MEDIUM · effort L.** New `seasons` table + a `season_week(viewerTs)`
  pure function; weekly leaderboard = existing leaderboard query scoped by `race_history.finishedAt`
  within the week bounds. Needs a season-XP aggregate (sum `xpGained` from `race_history`). Reset =
  filter, not delete.
- **Unlock track (cosmetics) — FEASIBLE-MEDIUM · effort M.** New `unlocks` table or a JSON column on
  `profiles`; level/achievement gates evaluated client-side from `profileSummary`.

### Archetype presets on SetupScreen
**FEASIBLE-NOW · effort S · pure client.** Three named preset skill allocations as constants in
`apps/web/src/race/SetupScreen.tsx` ("Атакующий" / "Тактик" / "Универсал"), each totalling
`STARTING_SKILL_POINTS` (10). Selecting one just pre-fills the existing skill sliders; the existing
`/api/profile/confirm` → `validateStartingAllocation` (api/http.ts:161) already enforces neutrality.
"Своя раскладка" stays as the advanced path.

### Situation-triggered tutorial rewrite
**FEASIBLE-MEDIUM · effort M.** `TutorialRoom` already streams `tutorialStep` hints
(tutorial-room.ts:41-46), currently lap-triggered. The engine state needed for situation triggers is
all readable server-side: hero `car.tyre.wear` (for a wear-triggered pit hint), `effectiveWeather`
(weather hint), and `events` of type `"overtake"` (engine.ts:633, attackerId/victimId) for an
overtake hint. Add new stable step ids + a trigger-evaluation block in the tutorial tick. Force-wear
the hero's tyres by overriding the bot/hero config for the tutorial race. Pure server + the existing
client overlay.

### Auto-warn / auto-pit instead of DSQ
**Auto-warn: FEASIBLE-NOW · effort S · pure client.** Detect hero with `tyreStops===0` past lap
`totalLaps-2` and show an urgent "BOX OR DSQ" toast.
**Auto-pit for the hero: OUT-OF-SCOPE — violates documented invariant.** `AGENTS.md`: *"the hero
pit ONLY on an explicit player pit request … never pitting → DSQ at the finish is the intended
consequence."* Also `engine.ts:382-385` deliberately auto-pits bots only.
**Cheaper substitute that captures the value:** keep player-owned pits (invariant), ship aggressive
auto-warn (FE), and **downgrade DSQ to a heavy time penalty** in `result()` (engine.ts:675,
`const dsq = noStop`) — e.g. +120s instead of `Infinity`, so a no-stop player finishes last-but-real
instead of DSQ. That is a one-line balance change, not a system. (Decision: take the warn now in S1;
defer the DSQ→penalty reclassification to a balance decision after seeing real churn data.)

### Mobile bottom-docked control bar
**FEASIBLE-NOW · effort M · pure client.** CSS media query `max-width: 768px` in
`apps/web/src/race/race.css`; reflow `RaceView` so Pit + Hammer controls dock to a thumb-reachable
bottom bar, canvas full-width on top. No logic change.

### Respec at level 3-4
**FEASIBLE-NOW · effort XS · config one-liner.** `CONFIG.respec.freeLevel: 10 → 4`
(config.ts:253). The `/api/profile/respec` handler (api/http.ts) already enforces `freeLevel` and the
30-day cooldown — no other change. Optional later: a one-time "starter respec token" usable in first
24h (needs a new `starterRespecUsed` column + 24h check — effort S, defer).

### "Надёжность" reliability stat for mechanical DNF
**FEASIBLE-MEDIUM · effort M as a full skill; FEASIBLE-NOW · effort XS as bot-only restriction.**
- **Restrict-to-bots (recommended now):** gate the failure roll at `engine.ts:319` with
  `&& driver.kind === "bot"`. The hero never DNFs by pure RNG; bots still do, for drama. One line.
  Captures the Gamer's "player has zero agency over it" complaint at zero architectural cost.
- **Full reliability stat (later):** adding a `SkillKey` ripples through `SKILL_KEYS` (config.ts:3),
  `Skills` type, `factory.ts`, `validateStartingAllocation`, SetupScreen, training catalog, DB hero
  JSON. The roll at engine.ts:319 would scale `basePerLap` by `1 - reliability×k`. Real subsystem —
  defer to S3.

### Cosmetics / season pass monetization
**Cosmetics-only (earnable, level-gated): FEASIBLE-MEDIUM · effort M (S3).** Unlocks table + FE
rendering of liveries/helmet colors/numbers. **Payment-based season pass / skip-timer purchases:
OUT-OF-SCOPE.** No payment provider integrated; adding one is a project of its own (provider eval,
webhooks, idempotent fulfillment, tax). Cheaper substitute: an earnable soft currency from
quests/streaks that buys cosmetics and training-skip — no real money, no pay-to-win risk (matches
`AGENTS.md`'s "not pay-to-win by construction"). Payment defers to a dedicated phase.

### "Shorten races" (Gamer alt for thin input budget)
**FEASIBLE-NOW · effort XS · config/balance.** `RACE.targetDistanceKm` (config.ts:17) drives
`recommendedLaps()`. Lowering it shortens all races. It's a balance knob, not a system. Decide after
the push-level + interactivity additions land (don't shorten AND add input — pick one per the
Gamer's own "pick one").

---

## PART 2 — Conflict reconciliation

**C1 — Mechanical DNF: Gamer wants remove/restrict-to-bots, Dev didn't flag. → Restrict to bots
(S0-7).** ~0.5%/race hero DNF by pure RNG with zero counterplay is a rage-quit vector and
contradicts the "player owns their race" design that already bans hero auto-pit. The cheap fix
(gate the roll on `driver.kind === "bot"`, engine.ts:319) keeps the drama for the field while
removing the unfair hero case. The fuller "надёжность" stat is deferred to S3 — not needed to solve
the churn.

**C2 — Push-level toggle vs AGENTS.md "no Push buttons." → Per-stint commitment only, with
sign-off (S2-4).** Architecturally the engine supports it today, but a real-time toggle contradicts
the documented "no real-time driving input" invariant. Ship it as a per-stint strategic pick (locked
at pit commit / race start), which is the same input category as compound choice. Requires the
`AGENTS.md` wording to be amended explicitly. If sign-off is denied, drop it — Hammer Time `push`
mode already gives burst pace.

**C3 — Dev P0 bugs (B1/B2/B3/B6) unmentioned by Gamer. → Confirmed absolute S0, nothing blocks
them.** B1 especially: without WS `hello` validation the "authoritative server" invariant
(`AGENTS.md`) is simply false — a client sends god-mode skills today via `room.ts:150`
(`existing.hero = hero` unvalidated). All UX/retention work is moot on a server that can be cheated
or crashed. These are tiny, independent, and ship first.

**C4 — Gamer weather-pit-prompt vs Dev G1 quali-weather. → Different areas, both ship, sequence
G1 first.** G1 (Dev) is an *engine correctness* fix: `QualifyingEngine` ignores weather
(qualifying-engine.ts:167-175) so rain-race grids are inverted — fix by forwarding `weather` into
`paceSpeedMultiplier`. The Gamer's pit-prompt is a *client reaction* to mid-race
`effectiveWeather`. Do G1 first (S1-4), then the prompt (S1-3). Neither blocks the other.

**C5 — Dev P1 wants to remove `events` from snapshot; Gamer wants events for overtake cinematics.
→ Delta-encode, don't remove (S1-5).** `events` is the raw growing array returned by reference
(engine.ts:752), broadcast 10×/s and unused by the client (confirmed: no `snap.events` reader in
`apps/web`). Removing it saves the bandwidth but kills the overtake-cinematic opportunity the Gamer
wants. Reconcile: add an `eventSeq` counter and send only `events.filter(e => e.seq >
lastSeenPerClient)` — or move events to a separate, lower-frequency `events` message keyed by seq.
Satisfies perf (Dev) and enables cinematics (Gamer). The `overtake` event (engine.ts:633) already
carries `attackerId`/`victimId`/`lap` — enough for sparks + standings flash.

**C6 — Gamer "DSQ for not pitting is a churn bomb" vs Dev/AGENTS.md "never pitting → DSQ is
intended." → Keep player-owned pits, add aggressive auto-warn now (S1-2), defer DSQ→penalty
reclassification.** The invariant (player owns pit timing) stays. The fix for churn is *communication*
(auto-warn, FE) plus B4 (the DSQ `info` event is currently dead code — engine.ts:670 guard
`c.finishPlace == null` is always false because `finishRace` sets finishPlace for every car at
engine.ts:658-660). Fixing B4 (S0-5) makes the DSQ visible; the auto-warn (S1-2) makes it preventable.
Only if churn data still bites do we reclassify DSQ → heavy time penalty.

---

## PART 3 — Final merged sprint plan

Notation: ID · Title · Source · Files · Change · Validation · Effort · Risk.

### SPRINT 0 — Launch blockers (P0 security / crash / correctness)
All small, all independent, all must precede feature work.

**S0-1 · WS hello/startTutorial hero validation (anti-cheat) · Dev B1**
- Files: `apps/server/src/server.ts` (hello handler ~:221, startTutorial ~:309),
  `apps/server/src/room.ts:140-175` (`resolveHeroProfile`), `apps/server/src/api/http.ts:340`
  (`isValidHero`, reuse).
- Change: in both WS handlers, validate `msg.hero` with `isValidHero` + `validateStartingAllocation`
  before calling `resolveHeroProfile`. For already-`heroConfirmed` profiles, reject skill changes
  entirely — accept only cosmetic fields (name/team/country). `resolveHeroProfile` must stop
  overwriting `existing.hero` wholesale (room.ts:150): merge only whitelisted cosmetic fields for
  confirmed profiles.
- Validation: `pnpm --filter @f1race/server test` (add a case sending oversized skills via `hello` →
  expect `error` and no profile mutation).
- Effort: S · Risk: MEDIUM (touches the profile path; regressions could block legit logins — gate
  behind the existing `heroConfirmed` flag).

**S0-2 · Runtime-validate pit compound + hammer mode (crash) · Dev B2**
- Files: `apps/server/src/room.ts:457` (`requestPit`), `:478` (`requestHammer`); reuse
  `VALID_COMPOUNDS` at room.ts:72; add a sibling `VALID_MODES: ReadonlySet<HammerMode>`.
- Change: `if (!VALID_COMPOUNDS.has(compound)) return "invalid tyre compound";` at the top of
  `requestPit`; `if (!VALID_MODES.has(mode)) return "invalid hammer mode";` at the top of
  `requestHammer`. Mirror the pattern already used in `requestSetStartingTyre` (room.ts:505).
- Validation: `pnpm --filter @f1race/server test` (send `{type:"pit",compound:"HACK"}` and
  `{type:"hammerTime",mode:"X"}` → expect `error`, room loop survives).
- Effort: XS · Risk: LOW.

**S0-3 · Type-validate speed value (NaN soft-brick) · Dev B3**
- Files: `apps/server/src/room.ts:445`.
- Change: `if (typeof value !== "number" || !Number.isFinite(value)) return "invalid speed";` before
  the clamp. Optionally also cap the JSON `maxPayload` (A5) in the WS server constructor.
- Validation: `pnpm --filter @f1race/server test` (send `{type:"speed",value:"abc"}` and `null` →
  expect `error`, race keeps advancing).
- Effort: XS · Risk: LOW.

**S0-4 · Graceful shutdown (SIGTERM/SIGINT) · Dev B6**
- Files: `apps/server/src/server.ts` (add handlers near `startServer`).
- Change: `process.on("SIGTERM"/"SIGINT", () => server.stop().finally(() => process.exit(0)))` with a
  5s hard-exit fallback. `stop()` should close the WS server + flush the repo (best-effort) and
  broadcast a "server restarting" notice.
- Validation: manual `kill -TERM <pid>` → connections closed cleanly, no orphaned WAL; unit-test
  that `stop()` is idempotent.
- Effort: S · Risk: LOW.

**S0-5 · Emit DSQ / 30s-penalty info events correctly · Dev B4**
- Files: `packages/race-engine/src/engine.ts:670-673`.
- Change: the guard `c.finishPlace == null` is dead (always false — `finishRace` sets finishPlace for
  every car at engine.ts:658-660). Drop the `&& c.finishPlace == null` condition; emit on `noStop` /
  `wrongCompound` alone. (Pairs with the auto-warn in S1-2.)
- Validation: `pnpm --filter @f1race/race-engine test` (race with a no-stop car → an `info` event
  with "дисквалификация" is present in `result().events`).
- Effort: XS · Risk: LOW.

**S0-6 · Compute positionsGained from post-penalty place · Dev B5**
- Files: `packages/race-engine/src/engine.ts:687` (move into the post-sort `rows.forEach` at :693).
- Change: after `rows.sort((a,b)=>a.raceTime-b.raceTime)` and `rows.forEach((r,i)=>r.place=i+1)`,
  set `r.positionsGained = Math.max(0, r.gridPosition - r.place)`. Delete the pre-sort assignment.
- Validation: `pnpm --filter @f1race/race-engine test` (construct a result where a 30s penalty drops
  a P3 car to P8 → `positionsGained` reflects P8, not P3 → no unearned XP).
- Effort: XS · Risk: LOW (XP awards shift slightly; re-run `sim:grid` to confirm no balance surprise).

**S0-7 · Restrict mechanical DNF to bots · Gamer (reconciled C1)**
- Files: `packages/race-engine/src/engine.ts:319`.
- Change: add `&& this.driverOf(car).kind === "bot"` to the failure-roll condition. Hero never DNFs
  by RNG; bots still do.
- Validation: `pnpm --filter @f1race/race-engine test` (long race, hero never flagged `dnf` from
  mechanicalFailure; bot DNF rate unchanged).
- Effort: XS · Risk: LOW.

### SPRINT 1 — Must-fix player experience

**S1-1 · Move first respec to level 4 · Gamer**
- Files: `packages/race-engine/src/config.ts:253`.
- Change: `respec.freeLevel: 10 → 4`. (The `/api/profile/respec` handler already enforces it.)
- Validation: `pnpm --filter @f1race/server test` (respec at level 4 succeeds, at level 3 → 409).
- Effort: XS · Risk: LOW.

**S1-2 · Aggressive pre-DSQ auto-warn · Gamer (reconciled C6)**
- Files: `apps/web/src/race/RaceView.tsx` + a small new component; depends on S0-5 events.
- Change: when hero `tyreStops===0` and `lap >= totalLaps-2`, show a pinned "BOX OR DSQ" banner.
  Pure FE; reads existing snapshot fields. No auto-pit (invariant preserved).
- Validation: manual — drive a no-stop race, banner appears 2 laps from end.
- Effort: S · Risk: LOW.

**S1-3 · Forced weather-change pit prompt · Gamer**
- Files: `apps/web/src/race/useRaceSession.ts` (track prev `effectiveWeather`), new overlay
  component in `RaceView.tsx`.
- Change: on `effectiveWeather` transition dry→rain, show dismissible "Смените резину?" with the
  recommended compound pre-selected (reuse `compoundForWeather` recommendation logic from
  `TyreSelectScreen.tsx`). Confirm sends the existing `{type:"pit", compound}`. No auto-pit.
- Validation: manual — force `weather:"variable"`, observe prompt at mid-race flip.
- Effort: S · Risk: LOW.

**S1-4 · Qualifying models weather · Dev G1**
- Files: `packages/race-engine/src/qualifying-engine.ts:167-175` (pass `weather` through to
  `paceSpeedMultiplier`), `apps/server/src/room.ts:686-694` (forward the room's sampled weather).
- Change: thread `weather` into `QualifyingEngine` and onward into `paceSpeedMultiplier` (which
  already accepts weather at formula.ts:70). Rain quali laps slow accordingly → grid reflects race
  conditions.
- Validation: `pnpm --filter @f1race/race-engine test` (heavy-rain quali field slower than dry,
  same seed); `pnpm --filter @f1race/race-engine typecheck`.
- Effort: S · Risk: MEDIUM (changes grid order — re-run `sim` to sanity-check field spread).

**S1-5 · Delta-encode snapshot events (perf + enables cinematics) · Dev P1 / Gamer (reconciled C5)**
- Files: `packages/race-engine/src/types.ts` (`RaceSnapshot` add `eventSeq: number` and tag each
  emitted event with a monotonic seq), `packages/race-engine/src/engine.ts` (assign seq in
  `pushEvent`, return only `events.slice(from)` or keep full but add seq), `apps/server/src/room.ts`
  (per-connection `lastEventSeq`, send filtered), `apps/web/src/race/useRaceSession.ts`.
- Change: stop returning the raw growing array by reference; each snapshot carries a `eventSeq` and
  only events with `seq > connection.lastEventSeq`. Client buffers them for the cinematic renderer
  (S2-3).
- Validation: `pnpm --filter @f1race/server test` (no event regressions); manual bandwidth check
  (snapshot size no longer grows over a race).
- Effort: M · Risk: MEDIUM (touches the snapshot shape — every test that reads events updates).

**S1-6 · Critical text fixes · Dev T1 / Gamer**
- Files: `apps/web/src/race/PitPanel.tsx:49` ("срочно питься!" → "срочно на пит-стоп!"),
  `PitPanel.tsx:83` (rule text), localise `"PERFECT START"` / `"LEVEL UP!"` / `"GO!"` / `"LAP n/m"`
  (find via grep), `SetupScreen.tsx:222` (broken Russian).
- Change: direct string edits; keep tyre labels (S/M/H) English per Gamer.
- Validation: manual screen sweep; typecheck.
- Effort: S · Risk: LOW.

**S1-7 · Landing hero + "Скоро" fix · Gamer**
- Files: `apps/landing/src/sections/Hero.tsx:24`, `apps/landing/src/components/CtaButton.tsx:19`.
- Change: hero headline to set the genre ("Ты не рулишь, ты решаешь"). Always show guest-play path
  when Yandex unconfigured (never a disabled "Скоро" as first impression).
- Validation: manual; `pnpm --filter @f1race/landing build`.
- Effort: S · Risk: LOW.

**S1-8 · Telemetry gap/format fixes · Dev B8/B9**
- Files: `apps/web/src/race/Telemetry.tsx:38-39` (compute gap-to-leader from standings or remove),
  `apps/web/src/race/colors.ts:51` (`formatGap` — compute `gapInLaps = sec / lapTime`, not `sec/60`).
- Change: derive leader gap from the standings array; pass per-track lap time into formatGap.
- Validation: manual — gap column shows real values, "+1.5l" only past one actual lap.
- Effort: S · Risk: LOW.

**S1-8b · Surface last-lap time per car (player-requested)**
- The engine already tracks `CarState.lastLapTime` (`types.ts:58`, set at `engine.ts:296`) and
  `bestLapTime` (`types.ts:59`), but **neither is in `CarSnapshot`** (`types.ts:196-223`) nor emitted by
  the snapshot builder (`engine.ts:710-744`) — so the client never sees any lap time during a race
  (`hero.bestLapTime` in `Telemetry.tsx:45` is always null mid-race; only qualy carries it via
  `QualyCarSnapshot`). The `Telemetry` "last lap" and "leader" slots are dead `—` placeholders.
- Files: `packages/race-engine/src/types.ts` (add `lastLapTime: number | null` + `bestLapTime: number |
  null` to `CarSnapshot`), `packages/race-engine/src/engine.ts:710-744` (emit `lastLapTime: c.lastLapTime,
  bestLapTime: c.bestLapTime ?? null`), `apps/web/src/race/useRaceSession.ts:91/165` (relay both),
  `apps/web/src/race/Telemetry.tsx` (show hero last lap + best lap in the dead slots),
  `apps/web/src/race/Standings.tsx` (optional last-lap column).
- Change: plumb the already-computed lap times to the snapshot; render hero's last lap ("ПОСЛ. КРУГ")
  and best lap ("ЛАЧШ.") in Telemetry, and a last-lap column in Standings.
- Validation: `pnpm --filter @f1race/race-engine test` + `typecheck`; manual — last lap appears after
  the first completed lap and updates each crossing of S/F.
- Effort: S · Risk: LOW.

**S1-9 · DB backup cron · Dev PR1**
- Files: new `scripts/backup-db.sh` on the VM (not in repo), systemd timer or crontab.
- Change: daily `sqlite3 ... ".backup"` + off-site copy + weekly `PRAGMA wal_checkpoint(TRUNCATE)`.
- Validation: restore-test on a staging copy.
- Effort: S · Risk: LOW.

### SPRINT 2 — Retention & feel

**S2-1 · Audio system · Gamer**
- Files: new `apps/web/src/race/audio.ts`; hook into `apps/web/src/race/RaceView.tsx`.
- Change: Web Audio engine-RPM loop pitched by `hero.v`, one-shots for DRS/hammer/pit-limiter/overtake.
  Mute toggle + respect a `prefers-reduced-motion`-adjacent audio default.
- Validation: manual; `pnpm --filter @f1race/web build`.
- Effort: M · Risk: LOW (no authoritative state).

**S2-2 · Hero-cam zoom/follow · Gamer**
- Files: `apps/web/src/race/TrackCanvas.tsx`.
- Change: camera transform toggle following hero; reuse `pathPointAt` (geometry only — invariant OK).
- Validation: manual.
- Effort: M · Risk: LOW.

**S2-3 · Overtake cinematics · Gamer (depends on S1-5)**
- Files: `apps/web/src/race/TrackCanvas.tsx`, `Standings.tsx`.
- Change: consume the delta events from S1-5; on `"overtake"` involving the hero (attackerId or
  victimId === heroId), flash the car, spawn sparks, pulse the standings row, trigger an audio sting.
- Validation: manual.
- Effort: M · Risk: LOW.

**S2-4 · Per-stint push-level commitment · Gamer (reconciled C2 — INVARIANT SIGN-OFF REQUIRED)**
- Files: `packages/race-engine/src/config.ts`, `engine.ts` (new `requestPushLevel(driverId, lvl)`
  + persist `car.pushLevel` + reset to balanced on fresh-tyre pit exit), `types.ts` (`PushStrategy`
  export), `apps/server/src/protocol.ts` (extend `setStartingTyre` or add `setPushLevel`), `room.ts`
  (handler), `apps/web/src/race/` (commit-time selector).
- Change: player picks Conserve/Balanced/Attack for the *next stint* at pit-commit (and at race
  start). Locked between stops — NOT a real-time toggle. `car.pushLevel = pushLevelFor(strategy)`
  (formula.ts:161, currently unused).
- Validation: `pnpm --filter @f1race/race-engine test` (attack yields faster lap times + higher wear
  than conserve, same driver); `sim:grid` (no auto-win build); `pnpm --filter @f1race/server test`.
- **Blocker: amend `AGENTS.md` "no Push buttons" wording first.** If denied → drop, rely on Hammer
  Time `push`.
- Effort: M · Risk: MEDIUM (game balance + invariant).

**S2-5 · Stats screen · Gamer**
- Files: new `GET /api/stats` in `apps/server/src/api/http.ts` (aggregate over `race_history`),
  new `apps/web/src/StatsScreen.tsx`, hub wiring.
- Change: "N races · W wins · P poles · avg place · best finish" from existing `race_history` rows.
- Validation: `pnpm --filter @f1race/server test` (route returns correct aggregates); manual.
- Effort: M · Risk: LOW.

**S2-6 · Archetype presets on SetupScreen · Gamer**
- Files: `apps/web/src/race/SetupScreen.tsx`.
- Change: 3 preset `Skills` constants summing to 10; one-tap fills sliders; "своя раскладка" stays.
  Existing `validateStartingAllocation` enforces neutrality on submit.
- Validation: manual; confirm each preset totals 10 and passes `/api/profile/confirm`.
- Effort: S · Risk: LOW.

**S2-7 · Situation-triggered tutorial rewrite · Gamer**
- Files: `apps/server/src/tutorial-room.ts` (trigger logic + new step ids), client overlay step
  coverage.
- Change: replace lap-based triggers with situation triggers (hero `tyre.wear ≥ 0.5` → pit hint;
  `effectiveWeather` flip → weather hint; `"overtake"` event involving hero → attack/hammer hint).
  Force the hero's tyre wear higher in the tutorial config so the pit situation reliably fires.
- Validation: `pnpm --filter @f1race/server test` (tutorial reaches pit_hint and hammer_hint within
  a 3-lap run); manual.
- Effort: M · Risk: MEDIUM (tutorial determinism).

**S2-8 · Mobile bottom-docked control bar + WCAG contrast · Gamer**
- Files: `apps/web/src/race/race.css` + `RaceView.tsx`, `apps/web/src/tokens.css`
  (`--text-tertiary` alpha 0.38 → ~0.5 for WCAG AA 4.5:1).
- Change: `@media (max-width:768px)` reflow — canvas full-width top, Pit+Hammer docked bottom,
  always visible. Hub building tap targets ≥ 44×44px. Detect touch to swap keyboard hints.
- Validation: manual mobile viewport; contrast checker.
- Effort: M · Risk: LOW.

**S2-9 · Daily quests · Gamer**
- Files: new `quests` table + migration in `sqlite-repository.ts`, new `/api/quests/*` routes in
  `api/http.ts`, progress hooks in `room.applyProgression` (race-finish) and training-complete, quest
  catalog constant, `apps/web/src/QuestsScreen.tsx` + hub badge.
- Change: 3 quests/day from a static pool ("топ-5", "2 обгона", "запусти тренировку"), assigned on
  first API hit of a UTC day, lazy progress read, claimed for XP + currency. Reuses lazy-completion
  pattern from `/api/training/state`.
- Validation: `pnpm --filter @f1race/server test` (assignment, progress increment, claim idempotent).
- Effort: L · Risk: MEDIUM (new persistence + protocol surface).

**S2-10 · Streak bonus · Gamer**
- Files: `sqlite-repository.ts` (add `lastRaceDay`/`streakDays` columns idempotently),
  `room.applyProgression` (streak recompute + XP multiplier).
- Change: +10% XP per consecutive race-day, cap 7 days.
- Validation: `pnpm --filter @f1race/server test` (streak grows across consecutive days, resets on a
  gap).
- Effort: S · Risk: LOW.

**S2-11 · Balance cluster · Dev G2/G3/G4 + Gamer wear/variable + Dev B7**
- Files: `packages/race-engine/src/config.ts` (HAMMER_TIME.mode.push cornering 1.30→~1.18 or
  tyreWear 3.0→4.0; `bots.rivalBonus` 10→division-scaled; `weather.probability.variable` 0.15→0.25;
  `tyres` wear curve to make mediums marginal at RBA; cliff-branch continuity at `tyres.ts:22`).
- Change: config-only tuning; validate with the harness scripts.
- Validation: `pnpm --filter @f1race/race-engine sim`, `sim:grid`, `tsx scripts/balance.ts`,
  `tsx scripts/spread.ts`.
- Effort: M · Risk: MEDIUM (game feel).

### SPRINT 3 — Polish, depth, monetization foundation

**S3-1 · Weekly seasons + leaderboard reset · Gamer**
- Files: new `seasons` table (or derive from `race_history.finishedAt`), `season_week(ts)` helper,
  `/api/leaderboard?season=current` scope, `apps/web/src/LeaderboardScreen.tsx` (season tab + timer).
- Change: weekly `driverRating`-gain leaderboard; reset = week-bound filter on `race_history`.
- Validation: `pnpm --filter @f1race/server test` (week boundary roll-over); manual.
- Effort: L · Risk: MEDIUM.

**S3-2 · Unlock track (cosmetics, earnable) · Gamer**
- Files: new `unlocks` table (or JSON column), level/achievement gates, `apps/web/src/GarageScreen.tsx`.
- Change: helmet colors / car numbers / liveries gated by level milestones + quest currency. No
  payment (S3-4 defers that).
- Validation: manual; repo round-trip.
- Effort: M · Risk: LOW.

**S3-3 · Reliability stat (fuller mechanical-DNF system) · Gamer**
- Files: `SkillKey` union + `SKILL_KEYS` (config.ts:3), `Skills`/`PilotProfile` types, `factory.ts`,
  `validateStartingAllocation`, SetupScreen + skills meta, training catalog, `engine.ts:319`
  (scale `basePerLap` by reliability). Supersedes the S0-7 bot-only gate if the stat also protects
  the hero.
- Change: a new `reliability` skill that reduces the hero's (re-enabled, small) mechanical-failure
  probability — gives the player agency over the DNF risk that S0-7 simply removed.
- Validation: full engine + server suite; `sim:grid` for balance.
- Effort: M · Risk: MEDIUM (type ripples across the stack).

**S3-4 · Earnable currency + cosmetics store (no payment) · Gamer**
- Files: `profiles` column `softCurrency`, `/api/store/*` routes, fulfillment, store UI.
- Change: currency from quests/streaks buys cosmetics + training-skip. **Payment provider
  integration is explicitly OUT-OF-SCOPE** (separate phase).
- Validation: `pnpm --filter @f1race/server test`.
- Effort: L · Risk: MEDIUM.

**S3-5 · Perf follow-ups · Dev P2/P3**
- Files: `apps/web/src/race/Standings.tsx:10-36` (split memo: geometry dep `[trackId]`, dots dep
  `[cars,heroId]`), `packages/race-engine/src/engine.ts:338-352` (precompute `segmentBoundaries`,
  binary search in `lookaheadSpeed`).
- Validation: manual profiling; `pnpm --filter @f1race/server load-baseline`.
- Effort: S · Risk: LOW.

**S3-6 · Prod hardening · Dev PR2/PR3/PR4/PR5**
- Files: `apps/server/src/server.ts` (pino logger, metrics emit, real `/health` that pings the DB +
  lobby timer), token-bucket rate limiter on `/auth/*` (10/min) and `/api/*` (60/min), Redis room
  snapshot (or at minimum a "server restarting" broadcast — partly covered by S0-4).
- Validation: `pnpm --filter @f1race/server test`; manual `/health` down-state.
- Effort: L · Risk: MEDIUM.

**S3-7 · Arch cleanups · Dev A2/A3/A4/A5**
- Files: `engine.ts` (return `[...this.events]` — partly superseded by S1-5), `room.ts`
  (`resolveHeroProfile` load-vs-update split — partly done in S0-1), move `__advanceForTest` to a
  `TestRoom extends Room`, WS `maxPayload` + string length caps (name ≤ 32).
- Validation: full suite.
- Effort: M · Risk: LOW-MEDIUM.

---

## Sequencing summary
- **S0 first, fully, no parallel feature work** — a cheatable/crashable server invalidates every UX
  fix. S0-1..S0-7 are all XS/S and independent.
- **S1 ships the churn-killers** (respec level 4, DSQ warn, weather prompt, quali weather, events
  fix, text/landing). S1-5 (events delta) unblocks S2-3 (cinematics).
- **S2 ships feel + retention skeleton** (audio, hero-cam, quests, streak, stats, archetypes,
  tutorial rewrite, mobile, balance). S2-4 (push-level) is gated on an `AGENTS.md` sign-off.
- **S3 is depth + monetization foundation** (seasons, cosmetics, reliability stat, earnable
  currency, perf/prod/arch hardening). Real-money payment stays out of scope.

## Top-10, if only ten ship
1. S0-1 anti-cheat · 2. S0-2 pit/hammer validation · 3. S0-3 speed NaN · 4. S0-7 DNF bots-only ·
5. S1-1 respec level 4 · 6. S1-2 DSQ auto-warn · 7. S1-5 events delta · 8. S1-7 landing/"Скоро" ·
9. S2-1 audio · 10. S2-8 mobile + WCAG.
