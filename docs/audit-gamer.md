# F1 RACE — Game Design Critique & Player Experience Plan (Gamer Agent)

## TL;DR VERDICT

The simulation is genuinely impressive. The game around it is not yet fun enough. The server-authoritative physics, real track geometry, tyre/weather/DRS modeling, and clean architecture are better than 90% of mobile racers. But the moment-to-moment player has almost nothing to do, the feedback is too quiet to generate drama, and the retention skeleton is missing every modern hook.

## 1. CORE GAME LOOP

### The input budget is dangerously thin
A race lasts ~4–5 minutes at 6× speed. In that window the player makes at most 3–5 inputs: 1 tyre pick, 1 reaction click, 1 pit decision, 1–2 Hammer Time presses. Everything else is spectating.

**Priority: MUST-FIX · Category: loop**

**Recommendations:**
- **Add a push-level toggle (Conserve / Balanced / Attack) per stint.** The engine already has `pushLevel` and three multipliers (`config.ts:46`), but the player can't touch them. Single biggest agency-add.
- **Surface weather changes as a decision, not a caption.** `variable` weather flips to rain mid-race and the player just watches their slicks die. Force a pit-prompt overlay the instant `effectiveWeather` changes.
- **Show the pit window and rival pit state.** "rival P2 boxed lap 6 → soft."
- **Shorten races OR add interactivity — pick one.**

### The loop closure is weak
`Hub → training (wait N hrs) → race → +XP → hub` is the whole loop. No "what do I want to achieve this session."

**Priority: SHOULD-FIX · Category: loop**

## 2. GAME FEEL

### No speed sensation, no drama
Cars are 24×12 px rectangles on a fixed full-track camera. No camera follow/zoom on hero. No speed lines, no motion blur, no FOV kick. **No audio at all.** No screen shake on overtakes/hammer.

**Priority: MUST-FIX · Category: feel**

**Recommendations:**
1. **Audio is the #1 feel fix.** Engine RPM mapped to `hero.v`, tyre squeal, DRS beep, Hammer Time impact stab, crowd swell on overtakes, pit-lane speed-limiter tick.
2. **Hero-cam mode.** Toggle that zooms ~2.5× and follows the hero car.
3. **Overtake cinematics.** `events` are computed but never rendered on the client — flash the attacker's car, spawn sparks, play a sting, pulse the standings row.
4. **Result screen needs a moment.** Checkered flag animation, position-gained counter ticking up, XP bar filling.
5. **Telemetry panel is under-used.** FL/FR/RL/RR tyre-temp slots (`Telemetry.tsx:69-77`) are empty `<span>`s. Wire them or cut them.

## 3. PROGRESSION & RETENTION

### The grind to the first respec is a trap
`respec.freeLevel = 10` (`config.ts:253`). Reaching level 10 needs ~7,700 XP = ~45–75 races. A new player needs 4–6 hours to undo a 30-second decision made with zero context. Single most likely churn vector.

**Priority: MUST-FIX · Category: progression**

**Recommendations:**
- **Drop `freeLevel` to 3–4**, OR give a "starter respec" token usable in first 24h.
- Make the 30-day cooldown currency-skippable when monetization lands.

### Retention hooks are entirely absent
No daily login reward, no daily quest, no streak, no season, no achievement, no unlock track, no collection.

**Priority: MUST-FIX · Category: progression**

**Recommendations (impact order):**
1. **Daily quests** (3/day): "Финишируй в топ-5", "Сделай 2 обгона", "Запустите тренировку". Reward XP + currency.
2. **Weekly seasons** with tier rewards tied to weekly `driverRating` gained, leaderboard reset.
3. **Unlock track** — new helmet colors, car numbers, team liveries, new tracks gated behind level milestones.
4. **Race-history & stats screen** — "82 races · 14 wins · 3 poles". `race_history` table already exists.
5. **Streak bonus** — +10% XP per consecutive-day race, capped at 7 days.

### Level curve & XP feel
Fastest-lap bonus (25 XP) is ~17% of a winning race's total — skews tryhard play toward "farm fastest lap." Consider 15. `positionsGainedBonus = 2` too low — P20→P10 yields only 20 XP.

**Priority: SHOULD-FIX · Category: progression**

### Training feels like a chore
Pure idle timer, no decision of type/risk/reward.

**Priority: SHOULD-FIX · Category: progression** — add training variants (intensity, specialist).

## 4. ONBOARDING / FIRST-TIME EXPERIENCE

### Drop-off #1: The first decision is the hardest one
`SetupScreen.tsx` forces a brand-new player to distribute 10 points across 6 skills before any context.

**Priority: MUST-FIX · Category: onboarding**

**Fix:** Offer 3 named archetypes ("Атакующий", "Тактик", "Универсал") as one-tap presets, with "своя раскладка" as advanced.

### Drop-off #2: The genre mismatch is never communicated
Landing hero says "Гонка, которую считает сервер, не сценарист" — engineering flex. Nothing tells the player they will NOT drive the car.

**Priority: MUST-FIX · Category: onboarding**

**Fix:** Landing headline must set the genre: *"Ты не рулишь. Ты решаешь."*

### Drop-off #3: The tutorial is too thin
3-lap race, 4 text banners, lap-triggered not situation-triggered. Doesn't teach compounds, weather, DRS, DSQ rule, 30s penalty.

**Priority: MUST-FIX · Category: onboarding**

**Fix:** Make tutorial scripted & situation-triggered. Put hero behind a slow bot, force wear ramp, trigger hints on situations. Add strategy panel. Award +30 XP bonus only if player actually pitted.

### Drop-off #4: Tyre select happens too fast
10-second overlay for a first-time player to parse 5 compounds + weather + recommendation.

**Priority: SHOULD-FIX · Category: onboarding** — extend to 30s for first 3 races + explanation.

## 5. BALANCE & FAIRNESS (player-facing)

### Feel-bad: DSQ for not pitting
Hero never auto-pits. A new player's first real race will frequently end in DSQ. Churn bomb.

**Priority: MUST-FIX · Category: balance** — auto-warn from lap N-1, or auto-pit with warning, or make DSQ a 60s penalty.

### Feel-bad: Mechanical DNF with zero agency
~1%/race, nothing the player can do. Rage-quit cause.

**Priority: SHOULD-FIX · Category: balance** — tie to visible "надёжность" stat, or restrict to bot cars.

### Hammer Time restrictions are opaque
60% tyre-wear gate, first-lap lock — never explained. Show lock icon with reason ON the button.

**Priority: SHOULD-FIX · Category: balance**

### Tyre strategy is narrower than it looks
At Red Bull Ring, mediums/hards one-stop trivially. "hard, one stop, never worry" is dominant boring strategy.

**Priority: SHOULD-FIX · Category: balance** — steepen wear curve or shorten races so mediums become marginal.

### Bot rival is a wall
`rivalBonus = 10` → bot #1 gets double F4 player's budget. Scale rivalBonus down in F4.

**Priority: NICE-TO-HAVE · Category: balance**

### Variable weather is the best part and it's rare
`variable = 0.15`. Raise to 25–30%. Surface the flip as a forced pit decision.

**Priority: SHOULD-FIX · Category: balance**

## 6. MONETIZATION / LIVE-OPS POTENTIAL

The game is not pay-to-win by construction. Candidates:
1. **Cosmetics** — car liveries, helmet designs, driver number, pit-crew skins. The neon aesthetic is made for this.
2. **Season pass** (free + premium) tied to weekly season.
3. **Training acceleration** (skip-timer with earnable currency).
4. **Respec tokens** (after free respec becomes early/generous).
5. **Track pack DLCs** (content-gated, not power-gated).

**Avoid:** power for cash, loot boxes with gameplay items, energy/hearts system.

## 7. TEXTS / COPY / NARRATIVE

### Landing hero headline is an anti-promise (MUST-FIX)
`Hero.tsx:24`: *"Гонка, которую считает сервер, не сценарист."* → *"Торможение, износ, дождь, обгон — всё по-настоящему. Ты не рулишь, ты решаешь."*

### English jank in all-Russian UI (SHOULD-FIX)
- `"LEVEL UP!"` → `"НОВЫЙ УРОВЕНЬ!"`
- `"PERFECT START"` etc → `"ИДЕАЛЬНЫЙ СТАРТ"` etc
- `"GO!"` → `"ВПЕРЁД!"`
- Tyre labels stay English (authentic to F1 broadcast, keep).

### "Скоро" is a terrible first impression (MUST-FIX)
`CtaButton.tsx:19` — disabled button when Yandex not configured. Always show guest-play path or fix config.

### Flat tutorial copy (SHOULD-FIX)
`tutorial-room.ts:41-46` — give stakes and identity.

### "Hammer Time" is never explained (SHOULD-FIX)
One-time tooltip: *"Hammer Time — короткий форсаж (8 с). Режим задаёшь ты: Атака / Оборона / Темп."*

### Error messages are flat and unhelpful (SHOULD-FIX)
"hammer time on cooldown" → *"Hammer Time перезаряжается (осталось 18 с)"*

### Pit panel copy bug (SHOULD-FIX)
`PitPanel.tsx:49` — "срочно питься!" typo. Plus `PitPanel.tsx:83` text contradicts actual rule (30s penalty, not a requirement).

### SetupScreen strategy note is broken Russian (SHOULD-FIX)
`SetupScreen.tsx:222` — mangled punctuation.

### LobbyPreview non-sequitur (NICE-TO-HAVE)
Apologizing for the marketing copy. Cut it.

## 8. MOBILE / ACCESSIBILITY

### Layout on phone is a risk (MUST-FIX)
Two-column layout. No mobile-specific breakpoint. Player mid-race needing to tap "pit" may have to scroll.

**Fix:** `<768px` breakpoint: canvas full-width on top, controls as bottom-docked thumb-reachable bar (Pit + Hammer always visible).

### Touch targets keyboard-biased (NICE-TO-HAVE)
Keyboard hints shown to touch users. Detect touch, swap hints.

### Hub touch targets may be small (SHOULD-FIX)
Ensure min 44×44px. Make building hint tap-to-expand popover.

### Contrast fails WCAG AA (SHOULD-FIX)
`--text-tertiary: rgba(255,255,255,0.38)` is ~3.2:1, needs 4.5:1. Bump to ~0.5 alpha.

### No colorblind fallback (NICE-TO-HAVE)
Add patterns/icons where color alone carries meaning.

### No `prefers-reduced-motion` respect in canvas (NICE-TO-HAVE)
Freeze sparks/rain, keep cars.

## CROSS-CUTTING PRIORITIES (if you fix only 10 things)

1. Add engine + tyre audio — biggest feel transformation
2. Add push-level toggle + forced weather-pit prompts — agency the loop needs
3. Kill the DSQ-on-first-race churn bomb
4. Move the first respec to level 3–4
5. Add daily quests + weekly seasons — missing retention skeleton
6. Rebuild the tutorial around situations, not laps
7. Offer archetype presets on the SetupScreen
8. Rewrite the landing hero + fix "Скоро"
9. Add a hero-cam zoom + overtake cinematics
10. Mobile bottom-docked control bar + WCAG contrast pass
