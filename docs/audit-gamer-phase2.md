# F1 RACE — Player-Priority Reconciliation (Gamer Agent · Phase 2)

> Reconciles the Gamer critique (`docs/audit-gamer.md`) with the Senior Game Developer audit
> (`docs/audit-game-dev.md`). I am not the engineer. I am the player's advocate. The engineer
> tells us what's feasible; this document says what **matters** and in what **order** from the
> seat of someone holding a phone at 23:30 deciding whether to queue one more race.

---

## 0. The one-sentence verdict

The Dev audit is technically correct and well-sequenced **for the server**; from the **player's
seat** it under-weights one thing (silent punishment) and over-weights another (anti-cheat) at the
very moment a first-time player arrives. The game's biggest risk is not that a cheater will forge
skills — it's that a legit newcomer will get **disqualified on their first race with no explanation**
and never come back. That single fact reorders everything.

---

## 1. The Dev's bugs, re-ranked by PLAYER HARM

The Dev ranked by technical severity / invariant risk. Re-ranking by **how much a real player
suffers, how often, and how early in their session**:

| New rank | ID | Dev rank | Player-harm verdict |
|---|---|---|---|
| **1** | **B4** — DSQ/penalty events never emitted | P1 | **The worst player experience in the game.** A new player's single most likely failure mode is "I forgot to pit." Their reward: a silent P20 with zero explanation. They conclude the game is broken or rigged. This is the #1 churn bomb and it is **silent**. Must be the first thing fixed. |
| **2** | **T1 + PitPanel copy** — "срочно питься!" + the 30s-rule text that contradicts itself | P1 | Hits the player at the exact moment of maximum stress (tyres dying mid-race) with a typo and a confusing rule. Cheap to fix, embarrassing to ship. |
| **3** | **B3** — speed NaN soft-bricks the room | P1 | When triggered, **the race silently freezes**. The player thinks it's lag, refreshes, loses their race. Rare trigger but a total confusion event. |
| **4** | **G1** — qualifying ignores weather → inverted grids in rain | P2 | Undercuts the **core promise** of the game ("tyres matter"). A player correctly picks wets for a wet quali, lines up last behind dry-shod bots, and learns the wrong lesson: "tyre choice doesn't work." MEDIUM-HIGH because it teaches the player the game is arbitrary. |
| **5** | **Raw-English hammer/pit error strings shown via error-toast** (Dev didn't catch this — `room.ts:487-494` returns `"hammer time on cooldown"` etc. straight to the UI) | — | A Russian-only UI suddenly flashes "hammer time locked on lap 1". Feels broken/unfinished. Trivial fix, high polish-per-minute. |
| **6** | **T3** — `"LEVEL UP!"`, `"PERFECT START"`, `"GO!"` in Russian UI | P3 (Dev) | Cosmetic per occurrence, but it punctuates **every emotional peak** of the game (the start, the level-up). Wrong language at the wrong moment = the celebration falls flat. |
| **7** | **B6** — no graceful shutdown | P0 (Dev) | Player harm = "my race vanished mid-stint." Rage-inducing when it happens, rare in practice, and the player's mental model ("server restarted") is forgiving. **Real, but not first-week.** |
| **8** | **B1** — anti-cheat bypass (arbitrary skills via WS hello) | **P0 (Dev)** | **Player-invisible today.** A solo player racing bots never feels it. It becomes player-facing **only** when leaderboards/multiplayer are the hook. Critical for *fairness*, but it is a **Wave-3 gate, not a Wave-0 quit-vector.** |
| **9** | **B2** — pit/hammer mode not validated → crash | P0 (Dev) | Requires a malicious client; can't happen to a legit solo player vs bots. Same character as B1: a **multiplayer/leaderboard gate**, invisible to a first-timer. |
| **10** | **B5** — `positionsGained` wrong for penalized cars → wrong XP | P1 (Dev) | Ironically this *over-pays* the penalized player, so it never feels bad to the recipient. Invisible to a solo player; a leaderboard-fairness issue only. Wave-3. |
| **11** | **B7** — tyre grip +3% jump at cliff | P3 (Dev) | 99% of players never notice. BUT: it **directly contradicts the game's central lesson** ("pit before the cliff") by rewarding the cliff with a grip boost. A min-maxer will post it; an attentive newcomer will be confused. Cheap fix → bundle with balance pass. |

### Where I disagree with the Dev, explicitly

- **B1/B2 at P0 is right for the codebase, wrong for the launch.** They are *fairness* P0, not
  *player-experience* P0. They must be fixed **before leaderboards go live** (Wave 3), but they do
  **not** block a first-time player's first race. Shipping without B4 fixed is unconscionable;
  shipping without B1 fixed (while the game is effectively solo/co-op vs bots) is tolerable for a
  soft launch. The Dev's P0 list would have us hardening the server while the front door is on fire.
- **B4 must be P0 from the player seat.** The Dev filed it P1. Promote it.
- **The raw-English error strings are a Dev blind spot** — they're "working as designed" at the
  protocol layer but they hit the player as untranslated jank. Filing it here.

---

## 2. My recommendations, defended or yielded against engineering reality

| # | My rec | Dev pushback? | Verdict | MVP that preserves the feel |
|---|---|---|---|---|
| 1 | **Audio (engine + tyres)** | None | **DEFEND — hardest** | 3 sounds only: an engine-drone loop whose pitch tracks `hero.v`, a tyre-squeal when `onCliff`, one overtake sting. Skip crowd/DRS/pit-limiter until Wave 4. |
| 2 | **Push-level toggle + forced weather-pit prompt** | None (engine already has `pushLevel` & `effectiveWeather`) | **DEFEND** | 3-state segmented control (Conserve/Balanced/Attack) bound to the existing multipliers; weather-pit prompt is a single overlay keyed off `effectiveWeather` change. |
| 3 | **Kill the DSQ-on-first-race churn bomb** | None — and **B4 makes it worse** (the warning that *should* fire is dead code) | **DEFEND, strengthened** | Auto-warn from penultimate lap with a flashing "BOX NOW" pill; if still no pit by S/F, **convert DSQ to a +60s time penalty** so the player still finishes and learns. |
| 4 | **First respec at level 3–4, not 10** | None | **DEFEND — cheapest win in the doc** | One config number (`respec.freeLevel: 10 → 4`). Zero engineering risk. |
| 5 | **Daily quests + weekly seasons** | None (but it's the biggest build) | **YIELD seasons to Wave 3; DEFEND daily quest in Wave 2** | Wave 2 MVP: **one** static daily quest ("Финишируй в топ-5"), one reward, one counter. Proves the loop. Full season system → Wave 3. |
| 6 | **Situation-triggered tutorial (not lap-triggered)** | Dev B10 only flags a dup calc | **DEFEND** | Reuse the existing `tutorialStep` channel; just change *triggers* (wear-crossing instead of lap count) and *copy*. No new protocol. |
| 7 | **Archetype presets on SetupScreen** | None | **DEFEND — trivial** | 3 buttons ("Атакующий/Тактик/Универсал") that each call `setCfg` with a fixed allocation. "Своя раскладка" reveals the manual grid. |
| 8 | **Rewrite landing hero + fix "Скоро"** | None | **DEFEND fully — "Скоро" has no excuse** | Guest mode **already exists** server-side; "Скоро" is just a missing client wire. Always show the CTA; if Yandex is unconfigured, route to guest play with a "или войдите через Яндекс, чтобы сохранить прогресс" secondary line. |
| 9 | **Hero-cam zoom + overtake cinematics** | Implicit: Dev P1 notes the `events` array is broadcast 10×/sec and **never read by the client** | **DEFEND hero-cam (cheap canvas transform); YIELD cinematics to Wave 4** | Hero-cam = one camera-mode toggle (2.5× follow). Cinematics wait until someone actually consumes `events` (and the Dev's P1 perf fix ships). |
| 10 | **Mobile bottom bar + WCAG contrast** | None | **DEFEND baseline in Wave 1, polish in Wave 4** | Wave 1: `<768px` breakpoint + Pit/Hammer always-visible in a thumb-docked bar + bump `--text-tertiary` alpha to ~0.5. Wave 4: reduced-motion, colorblind patterns. |

### Self-critique: were my "fix only 10 things" the right 10?

**Mostly yes, with two reorders now that I've seen the Dev's list:**

- **Demote audio from #1 to Wave 2.** Audio is the biggest *feel* transformation, but it does
  nothing for a player who **got silently DSQ'd and quit before lap 3**. Player-visible correctness
  (B4, copy, genre-setting) pre-empts feel. I had this slightly backwards.
- **Promote "explain the genre on the landing + tutorial" into the top 3.** I had it as onboarding
  #2; seeing the Dev's P0 list confirmed nothing in it sets player expectations correctly. A player
  who doesn't know they *won't drive the car* will bounce in 20 seconds — before any bug matters.

**Can bug-fixing and feel work run in parallel?** Yes, with a rule:

- **Player-visible bugs (B4 silent DSQ, B3 frozen race, all copy jank) are Wave 0** — they pre-empt
  feel/onboarding because they actively **lie** to the player. A polished UI that silently DSQs you
  is worse than an ugly one that explains itself.
- **Player-invisible hardening (B1 anti-cheat, B2 input validation, B6 shutdown, B5 XP-correctness)
  runs in parallel** and **gates Wave 3** (leaderboards/seasons). It does not block Waves 0–2.

This lets the engineer harden the server while the designer fixes the front door. The only hard
dependency is: **do not ship the public leaderboard until B1/B2/B5 are fixed.**

---

## 3. The Player-Priority Work List

Format per item: **ID · player value ("a player who ___ will now ___") · source · confidence · MVP scope.**

### Wave 0 — Don't ship without this
*(Bugs/issues that make a first-time player quit, or that break fairness at the moment of contact.)*

- **W0.1 · EXPLAIN THE PUNISHMENT (fix B4 + the DSQ churn bomb together).**
  A player who forgets to pit will now **see why they lost and get a soft landing instead of a silent P20.**
  *Source: Dev B4 + Gamer #3.* Confidence: **very high.**
  *MVP:* (a) emit DSQ/penalty events (Dev's fix); (b) render them as a result-screen banner; (c) **convert hero DSQ to a +60s time penalty** so they still finish and learn. One engine change, one UI banner.

- **W0.2 · PIT CLIFF COPY + RULE CLARITY (fix T1 + PitPanel).**
  A player whose tyres die will now **read "срочно на пит-стоп!" and understand the 30s rule.**
  *Source: Dev T1 + Gamer.* Confidence: **very high.** *MVP:* two string edits (see §4).

- **W0.3 · KILL THE RAW-ENGLISH ERROR STRINGS (Dev blind spot).**
  A player whose Hammer is locked will now **see a Russian reason with a countdown** instead of "hammer time on cooldown".
  *Source: Gamer (newly surfaced).* Confidence: **very high.** *MVP:* client maps the `error` to a localized string + reads `hero.hammerTime.remainingSec` for timing.

- **W0.4 · LOCALIZE THE EMOTIONAL PEAKS (T3).**
  A player who hits a perfect start / levels up will now **celebrate in their own language.**
  *Source: Dev T3 + Gamer.* Confidence: **high.** *MVP:* swap 6 strings (see §4).

- **W0.5 · LANDING HERO + "СКОРО" (Gamer #8).**
  A landing visitor will now **understand the genre in 3 seconds and can ALWAYS start a race.**
  *Source: Gamer.* Confidence: **very high** (this is the front door). *MVP:* headline/subhead rewrite + always-on guest CTA.

- **W0.6 · SPEED-NaN GUARD (B3).**
  A player's race will now **never silently freeze.**
  *Source: Dev B3.* Confidence: **high.** *MVP:* one `typeof` guard in `Room.requestSpeed`.

### Wave 1 — The first 90 seconds & first race
*(Onboarding, genre-setting, first-race feel.)*

- **W1.1 · ARCHETYPE PRESETS (Gamer #7).**
  A player who has never seen the skill grid will now **start a race in one tap** instead of solving a 10-point puzzle cold.
  *Source: Gamer.* Confidence: **very high.** *MVP:* 3 preset buttons + "своя раскладка".

- **W1.2 · TUTORIAL OPENING = GENRE CONTRACT (Gamer onboarding #2/#3).**
  A player who loads the tutorial will now **learn "you don't drive, you decide" in the first sentence.**
  *Source: Gamer.* Confidence: **very high.** *MVP:* rewrite the `welcome` step copy (see §4).

- **W1.3 · HAMMER TIME ONE-TIME EXPLAINER (Gamer #160).**
  A player who first sees the Hammer button will now **know what it does and that it has a cost.**
  *Source: Gamer.* Confidence: **high.** *MVP:* a dismissible tooltip the first time `hammerTime.state === "available"`.

- **W1.4 · TYRE SELECT: 30s FOR NEWCOMERS + "WHY THIS COMPOUND".**
  A player choosing tyres for the first time will now **have time to read and a reason for each pick.**
  *Source: Gamer onboarding #4.* Confidence: **high.** *MVP:* `COUNTDOWN_SEC = 30` for first 3 races; one-liner per compound (see §4).

- **W1.5 · SITUATION-TRIGGERED TUTORIAL HINTS (Gamer #6).**
  A player will now **get the pit hint when their tyres are actually dying**, not on an arbitrary lap.
  *Source: Gamer.* Confidence: **high.** *MVP:* change the `pit_hint` trigger to `tyreWear ≥ 0.5`; add a `weather_hint` when `effectiveWeather` flips. Reuses `tutorialStep`.

- **W1.6 · FIRST RESPEC AT LEVEL 4 (Gamer #4).**
  A player who botched their first build will now **undo it within an hour, not after 45 races.**
  *Source: Gamer.* Confidence: **very high.** *MVP:* `respec.freeLevel: 10 → 4`. One config line.

- **W1.7 · MOBILE USABILITY BASELINE (Gamer #10).**
  A player on a phone will now **reach Pit and Hammer without scrolling mid-race.**
  *Source: Gamer.* Confidence: **high** (if mobile is a launch channel). *MVP:* `<768px` breakpoint, thumb-docked control bar, contrast bump.

### Wave 2 — The second race
*(Retention hooks, loop closure, the reason to queue again.)*

- **W2.1 · AUDIO MVP (Gamer #1).**
  A player who queued again will now **hear the race for the first time** — engine, squeal, sting.
  *Source: Gamer.* Confidence: **very high** (biggest single feel transformation). *MVP:* 3 sounds.

- **W2.2 · RESULT SCREEN MOMENT (Gamer feel #4).**
  A player who finishes will now **get a checkered flag, a ticking position counter, and a filling XP bar.**
  *Source: Gamer.* Confidence: **high.** *MVP:* flag animation + animated counters (no new data).

- **W2.3 · DAILY QUEST MVP (Gamer #5).**
  A player will now **have a reason to queue today** beyond "one more race".
  *Source: Gamer.* Confidence: **high.** *MVP:* one static quest, one reward, one counter.

- **W2.4 · HERO-CAM TOGGLE (Gamer feel #2).**
  A player will now **feel speed** for the first time.
  *Source: Gamer.* Confidence: **medium-high.** *MVP:* one camera-mode toggle.

- **W2.5 · WEATHER-CHANGE PIT PROMPT (Gamer loop #2).**
  A player whose dry race turns wet will now **get a forced decision, not a caption.**
  *Source: Gamer.* Confidence: **high.** *MVP:* overlay on `effectiveWeather` change.

- **W2.6 · QUALIFYING MODELS WEATHER (Dev G1).**
  A player in a wet quali will now **line up where they belong**, not last behind dry-shod bots.
  *Source: Dev G1 + Gamer.* Confidence: **high.** *MVP:* pass `weather` into `QualifyingEngine`.

- **W2.7 · VARIABLE WEATHER 25–30% + BALANCE PASS (Gamer balance).**
  A player will now **see the best feature of the game often enough to learn it.**
  *Source: Gamer.* Confidence: **medium-high.** *MVP:* config bump; bundle B7 cliff-fix + tyre-wear curve so "hard one-stop" stops being dominant.

### Wave 3 — The first week
*(Progression depth, seasons, social/leaderboard meaning. **Gated on the hardening items below landing first.**)*

- **W3.0 · HARDENING GATE (must land before W3.1+ goes live).**
  - **B1** validate WS `hello`/`startTutorial` hero (reject skill changes for confirmed profiles; `validateStartingAllocation` otherwise).
  - **B2** `VALID_COMPOUNDS` + `VALID_MODES` checks in `requestPit`/`requestHammer`.
  - **B5** compute `positionsGained` from final post-re-sort place.
  - **B6** SIGTERM/SIGINT handlers + "server restarting" broadcast.
  - **P1** stop broadcasting the unused `events` array 10×/sec (perf + unblocks W4.1).
  *Source: Dev.* Confidence: **very high** that these gate any competitive feature.

- **W3.1 · WEEKLY SEASONS + LEADERBOARD RESET (Gamer #5).**
  A player will now **care where they rank** because the board resets Monday.
  *Source: Gamer.* Confidence: **high.**

- **W3.2 · RACE HISTORY & STATS SCREEN (Gamer retention #4).**
  A player will now **see "82 races · 14 wins · 3 poles"** and feel invested.
  *Source: Gamer.* Confidence: **high.** *MVP:* read the existing `race_history` table.

- **W3.3 · STREAK BONUS + LOGIN REWARD (Gamer retention #5).**
  A player will now **have a reason to come back tomorrow.**
  *Source: Gamer.* Confidence: **medium-high.**

- **W3.4 · PUSH-LEVEL TOGGLE (Gamer loop #1).**
  An engaged player will now **have a real lever to pull each stint.**
  *Source: Gamer.* Confidence: **medium** (deferred from Wave 1 because first-timers don't need it; it's a week-2 depth add).

### Wave 4 — Delight & breadth

- **W4.1 · OVERTAKE CINEMATICS** — now possible once `events` is consumed (post W3.0/P1). Flash attacker, sparks, sting, standings pulse.
- **W4.2 · MORE TRACKS** — content-gated, not power-gated.
- **W4.3 · COSMETICS** — car liveries, helmet, driver number. The neon aesthetic is made for this.
- **W4.4 · SEASON PASS + RESPEC TOKENS** — monetization that respects the not-pay-to-win invariant.
- **W4.5 · MECHANICAL DNF → "НАДЁЖНОСТЬ" STAT** — gives the 1% DNF player agency instead of rage.
- **W4.6 · AUDIO BREADTH** — crowd swell, DRS beep, pit-lane limiter tick.
- **W4.7 · A11Y POLISH** — `prefers-reduced-motion`, colorblind patterns, touch-target audit.

---

## 4. FINAL COPY (Russian, paste-ready)

### 4.1 Landing hero (`Hero.tsx`)
```
Headline:
Ты не рулишь. Ты решаешь.

Subhead:
Стратегия, износ резины, пит-стопы, погода и обгоны — всё по-настоящему.
Машина едет сама. Побеждает тот, кто принимает верные решения.
Гонку считает сервер: честно и без сценариев.
```

### 4.2 Start-light banners + "GO!" (`StartLights.tsx`)
```
perfect    → ИДЕАЛЬНЫЙ СТАРТ
good       → ХОРОШИЙ СТАРТ
slow       → МЕДЛЕННЫЙ СТАРТ
verySlow   → ОЧЕНЬ МЕДЛЕННЫЙ
jumpStart  → ФАЛЬСТАРТ
GO!        → ВПЕРЁД!

Приговор фальстарту (替换 "Фальстарт — штраф"):
Фальстарт — потеря времени на старте

Ожидание (保留, нормально):
✓ реакция принята, ожидание…
Приготовиться…
Красные загораются — реагируй на погасание
Space / Enter / клик
```

### 4.3 "LEVEL UP!" (`RaceView.tsx:262` ProgressionCard)
```
LEVEL UP!  →  НОВЫЙ УРОВЕНЬ!
```
*(Note: `LevelUpModal.tsx:47` already correctly says "Новый уровень!" — make the in-race card consistent.)*

### 4.4 Pit panel cliff warning (`PitPanel.tsx:49`) + rule line (`PitPanel.tsx:82`)
```
Cliff (替换 "срочно питься!"):
Износ {N}% — резина «поплыла», срочно на пит-стоп!

Rule line (替换 всю строку `ds-hint`):
Пит-стоп ≈ {PIT_DELTA} с. Обязателен один останов со сменой состава.
Тот же состав (свежий комплект) — штраф 30 с.
Без останова — дисквалификация.
Inter/Wet — на дождь.
```

### 4.5 Hammer Time one-time explainer (new tooltip)
```
Заголовок: Hammer Time
Текст:
Короткий форсаж на 8 секунд, затем долгая перезарядка.
Режим выбираете вы:
  • Атака — повысить шанс обгона
  • Оборона — удержать позицию
  • Темп — отрыв / быстрый круг
Доступен со 2-го круга, пока резина свежая (износ < 60%).
Один режим за активацию — выбирайте момент.
```

### 4.6 DSQ / penalty warnings (new — surface Dev B4)
```
On DSQ finish (result-screen banner):
ДИСКВАЛИФИКАЦИЯ
Вы не сделали обязательный пит-стоп со сменой состава.
Один раз за гонку нужно заехать в боксы и поменять резину.

On 30s same-compound penalty:
+30 с штраф
Пит-стоп без смены состава. В следующий раз смените резину.

(Wave 0 soft-landing variant — if DSQ is converted to +60s:
+60 с штраф
Вы не сделали пит-стоп со сменой состава — штрафное время добавлено.
В следующий раз заезжайте в боксы до финиша.)
```

### 4.7 Tutorial opening line (`tutorial-room.ts:42`, `welcome` step)
```
Заголовок: Гонка-стратегия
Текст:
Машину вы не рулите. Вы — инженер на стенке.
Решаете, когда менять резину и когда атаковать.
Цель: доехать до финиша. Для этого нужен один пит-стоп со сменой состава.
Следите за подсказками.
```

### 4.8 Hammer / pit lock error strings (replace raw-English in `room.ts:487-494`)
*Render client-side using `hero.hammerTime.remainingSec` for the countdown.*
```
rejected_cooldown   → Hammer Time перезаряжается — осталось {N} с.
rejected_pit        → Hammer Time недоступен в боксах.
rejected_first_lap  → Hammer Time откроется на 2-м круге.
rejected_tyre_wear  → Резина слишком изношена для Hammer Time (износ > 60%). Смените её на пит-стопе.
rejected_not_racing → Hammer Time сейчас недоступен.
rejected_unknown_driver → Hammer Time сейчас недоступен.

pit only available during the race → Пит-стоп доступен только во время гонки.
tyre can only be chosen before the race → Резину выбирают до гонки.
invalid tyre compound → Неизвестный состав резины.
```

### 4.9 TyreSelectScreen "why this compound" one-liners (extend `DRY_OPTIONS` / `WET_OPTIONS`)
```
soft         → Самая быстрая, но служит меньше всех. На короткий отрезок.
medium       → Баланс скорости и ресурса. Универсальный выбор.
hard         → Медленнее, но долго не «плывёт». На длинную дистанцию.
intermediate → Для слабого дождя и влажного асфальта. На сухе быстро изнашивается.
wet          → Для полного дождя. На сухе почти не едут.

Подтверждение (替换 "Подтвердить · {COMPOUND}"):
Поехали на {COMPOUND}
```

### 4.10 Consistency fix (Dev T2) — pick ONE label for `variable`
```
Переменная   (использовать везде; убрать «Перемен.» и «Переменная облачность»)
```

---

## 5. The one thing to remember

A player will forgive ugly graphics, missing audio, and a thin loop. They will **not** forgive being
**silently punished**. The Dev's P0 is right for the server; the player's P0 is **W0.1**: make the
game explain its own rules — especially the ones that end your race. Everything else is a richer
version of a game that, at minimum, tells the truth.
