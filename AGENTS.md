# AGENTS.md

Compact guide for OpenCode sessions working in this repo. Read before running/editing.

## Layout (pnpm workspace)

- `packages/race-engine` — pure TS simulation library (no DOM/Node I/O). `RaceEngine` (race) + `QualifyingEngine` (qualifying). **All formulas/balance live in `src/config.ts`** — this is the single tuning surface.
- `apps/server` — Node + WebSocket. Authoritative: runs qualy → race, broadcasts `snapshot()`, accepts `hello`/`pit`/`speed`/`pause`/`restart`.
- `apps/web` — Vite + React + Canvas. Renders snapshots only. **No game logic belongs here** (online/anti-cheat invariant).

## Install gotcha (esbuild) — read this

`pnpm install` leaves esbuild's postinstall blocked → `ERR_PNPM_IGNORED_BUILDS` makes `pnpm install` and `pnpm <script>` wrappers return non-zero. Already mitigated by `pnpm-workspace.yaml` (`onlyBuiltDependencies`) and `.npmrc` (`verify-deps-before-run=false`), but on a clean checkout it can still bite. Reliable fix:

```
pnpm install
pnpm rebuild esbuild        # do this once if pnpm complains or scripts exit non-zero
```

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
```

Engine has 33 vitest tests (race + qualifying). No tests for server/web yet. No lint is configured (script is a no-op echo).

## TypeScript strictness that will bite you

`tsconfig.base.json` enables `verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`. In `race-engine` especially:

- Use `import type` for type-only imports.
- Never assign `undefined` to an optional field inline — build the object, then set the field conditionally. (Web/server tsconfigs relax `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.)
- Indexing an array returns `T | undefined`; guard it.

## Tuning gameplay

Edit `packages/race-engine/src/config.ts`, then validate with the balance harness (do NOT raise seed count much — it runs full races and gets slow):

```
pnpm --filter @f1race/race-engine sim          # one race, printed grid + result
pnpm --filter @f1race/race-engine sim:grid     # compare hero builds
tsx packages/race-engine/scripts/balance.ts    # avg finishing place across seeds/builds
```

Goalpost: no single hero build or tyre combo should be auto-win/auto-loss. `recommendedLaps(track)` derives lap count from a target race distance (not hardcoded).

## Conventions

- Comments: none in code unless a non-obvious formula/physics reason — keep it that way.
- Engine dt = 0.1s; server ticks ~10×/s and advances `speed × tick` sim-steps per tick.
- No git remote, no CI, no migrations/codegen.
