# load-baseline (Room model, Phase 1)

Re-measurement of server throughput on the real `Room` model (spec Фаза 1 deliverable
«уточнение load-baseline на Room-модели»; the Phase 0 proxy on the old single-player
`GameSession` is superseded by this). The goal is a concrete number for open question Q2
(spec §7.2): is single-process + periodic Redis snapshot enough for "tens of rooms", or
do we need worker isolation before we even start?

## Harness

`apps/server/scripts/load-baseline.ts` (run via `pnpm --filter @f1race/server load-baseline`).

- Builds N `Room`s, each with **M = 2 live connections** (so `mode === "multiplayer"` →
  the tick runs at fixed real-time, **1 sim-step per tick**, the worst-case pacing for a
  live room). Each room is filled to the full 20-car field with bots.
- Connections are in-memory `RoomSink`s that `JSON.stringify` every broadcast message and
  discard the result — this approximates wire-serialisation cost per connection per tick
  without a real socket. (Snapshot serialisation is therefore counted; actual network I/O
  is not — see caveat below.)
- Each room is advanced adaptively until `currentStage === "race"` (the heavy stage:
  `handleBattles`/`updateBlueFlags`/`updatePositionsAndTrains` are all O(n²) over 20 cars),
  then a steady-state window of 400 race ticks is timed.
- `performance.now()` wall-clock for the timed window ÷ (ticks × rooms) = per-room ms/tick.
- RSS from `process.memoryUsage().rss`.

Environment: Node v26.4.0, macOS, single thread, no real WS clients. A throwaway room is
run to race before measurement to avoid penalising the first case with V8 JIT cold-start.

## Measured numbers

| rooms | conns/room | qualy ms/tick | race ms/tick | full-frame ms (N rooms) | RSS MB | rooms reached race |
|------:|-----------:|--------------:|-------------:|------------------------:|-------:|-------------------:|
|     1 |          2 |        0.0107 |       0.0384 |                   0.04  |   84.5 | 1/1                |
|    10 |          2 |        0.0105 |       0.0310 |                   0.31  |   87.9 | 10/10              |
|    50 |          2 |        0.0103 |       0.0316 |                   1.58  |   98.2 | 50/50              |
|   100 |          2 |        0.0113 |       0.0332 |                   3.32  |  105.6 | 100/100            |

The 10 Hz server tick has a **100 ms wall-clock budget per frame**. Per-room race cost
settles at ~**0.031–0.033 ms/tick** in steady state (the N=1 figure is mildly higher due
to small-sample timer noise; N=10/50/100 agree). Qualifying is ~3× cheaper (no inter-car
battle/blue-flag/position passes).

**RSS:** ~85 MB baseline (Node + engine dist) growing ~0.2 MB per room → ~106 MB at 100
rooms. Memory is not the constraint.

### Budget projection

- 100 rooms in one frame: **3.3 ms** (3.3 % of the 100 ms budget; +96.7 ms headroom).
- Linear extrapolation (rooms are independent, no cross-room work): 100 ms / 0.033 ms ≈
  **~3000 rooms per core** before the simulation alone saturates a 10 Hz frame.
- Real capacity is lower than the raw extrapolation (snapshot JSON-serialisation for more
  connections per room, real WS write syscalls, GC pauses, the `setInterval` jitter), but
  the order of magnitude is unambiguous: the simulation is **not** the bottleneck for any
  realistic Phase 1–4 scale.

## Caveats

- **No real network I/O.** `RoomSink.send` only `JSON.stringify`s; `ws.send`/syscall cost
  and backpressure are not measured. For 2 conns/room this is negligible; for a full
  20-human room it would add M× serialisation + M× socket writes per tick and should be
  re-measured before claiming capacity for full rooms.
- **Single process, single thread.** Node's event loop serialises all rooms' ticks; the
  numbers above already reflect that (one core). Multi-core would require worker isolation
  (see Q2 second branch), which is **not** justified by these numbers.
- **No GC pressure test.** Long-running rooms accumulate `events` arrays in the engine;
  unbounded growth over a real (~hour-long) session is a separate concern (snapshot
  trimming / event ring buffer) and is not captured by a 400-tick window.

## Conclusion (answers Q2)

**For "tens of rooms" the architecture in spec §3 (single authoritative process +
periodic Redis snapshot for recovery, spec P10) is more than adequate** — at 50 rooms the
whole frame costs 1.6 ms, leaving ~98 ms of headroom per tick on a single core. Even
**"hundreds of rooms" (N=100 measured here, ~3000 extrapolated) is comfortable** in one
process for the simulation itself; the binding constraint at that scale would be aggregate
network I/O for full 20-human rooms, not CPU.

Concretely for the phasing plan: there is **no need** to design worker isolation / session
migration for Фазы 1–4. Single-process + periodic Redis snapshot (P10) is the right call
through the lobby/matchmaking phase. Worker-level isolation only becomes worth its
complexity if real-room re-measurement (with full 20-human rooms and real sockets) shows
the frame budget being consumed by I/O — which should be re-checked once Phase 4 fills
rooms with real players, not before.
