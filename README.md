# F1race

Браузерная аркадная игра по Формуле-1 (RPG + онлайн-аркада). **Онлайн-мультиплеер с матчмейкингом**: авторитетный сервер крутит симуляцию (квалификация → стартовый мини-гейм «светофор» → гонка) и раздаёт снапшоты клиентам по WebSocket; браузер только рендерит. Создание пилота, лендинг + хаб, фоновые тренировки навыков, live-квалификация, лобби по дивизионам (добор ботами; матчмейкинг по двухфакторному `driverRating` из уровня + навыков), пит-стопы, сохранение прогресса (XP/уровни), вход через Яндекс.

**Прод:** [f1-race.ru](https://f1-race.ru) (Yandex Cloud VM, см. AGENTS.md «Production»).

## Архитектура
- **`packages/race-engine`** — чистая TS-библиотека без I/O: `RaceEngine` (гонка) и `QualifyingEngine` (квалификация). Все формулы/баланс — в `src/config.ts`. Не зависит от DOM/Node.
- **`apps/server`** — Node + WebSocket: `Lobby` матчит игроков по `division` в `Room` (добор ботами до 20); `Room` авторитетно крутит квалу → startSequence → гонку и раздаёт `snapshot()`. Принимает `hello`/`reconnect`/`restart`/`pit`/`cancelPit`/`speed`/`pause`/`startReaction`. Персистентность профилей (SQLite), Yandex OAuth (authorization-code flow), session-токены. WS-протокол и message-типы — в `src/protocol.ts`.
- **`apps/web`** — Vite + React + Canvas: подключается по WS, рендерит снапшот, отправляет команды. Экран лобби, светофор-мини-гейм, пит-панель, телеметрия, таблица. Никакой игровой логики на клиенте.

## Запуск локально

Node ≥ 20 (dev на 26), pnpm ≥ 10. Понадобятся два терминала (сервер + клиент).

```bash
pnpm install
pnpm rebuild esbuild              # если pnpm блокирует postinstall (см. AGENTS.md)
pnpm --filter @f1race/race-engine build   # собрать dist (нужно серверу)

# терминал 1 — сервер (ws://localhost:8787)
pnpm --filter @f1race/server dev

# терминал 2 — клиент (http://localhost:5173)
pnpm --filter @f1race/web dev
```

Env (через `apps/web/.env.local`):
- `VITE_WS_URL` — адрес WS (по умолчанию `ws://localhost:8787`).
- `VITE_YANDEX_CLIENT_ID` — Яндекс OAuth client_id (публичный); если не задан, кнопка «Войти через Яндекс» скрыта и игра работает в гостевом режиме.

## Игровой цикл
0. **Лендинг → вход через Яндекс** (единая кнопка OAuth; без входа хаб/тренировки недоступны). При первом входе — **онбординг**: `SetupScreen` (имя, страна, команда-академия, распределение 10 очков по 6 навыкам; стартовая резина выбирается перед гонкой, не здесь). Подтверждение → профиль сохраняется навсегда.
1. **Хаб**: карточка пилота (дивизион/рейтинг/уровень), 6 полос навыков, **сетка тренировок** (фоновая прокачка навыка по таймеру, +1 по истечении; одна активная за раз; длительность растёт с уровнем навыка) и отдельный CTA **«Гонка»** (вход в лобби, не смешивается с тренировками).
2. **Лобби**: игрок попадает в очередь, сервер группирует по дивизионам (F4/F3/F2/F1, по `driverRating` — двухфакторный рейтинг из уровня + суммы навыков) и создаёт комнату (добор ботами до 20). Solo-игрок не ждёт > 2 с.
3. **Квалификация** (симуляция): выезд из боксов с интервалом 5 c, круг прогрева и боевой круг — лучшее время задаёт стартовую решётку.
4. **Стартовый мини-гейм «светофор»**: 5 красных огней гаснут по серверному таймстемпу — реакция игрока (клик/Space) измеряется на сервере (защита от пинга/фальстартов).
5. **Гонка** (Red Bull Ring, круги по дистанции ~85 км): top-down вид, пит-стоп с обязательной сменой состава (правило Ф1), потеря ≈20 c, андеркот, «поезда» и синие флаги для круговых.
6. **Финиш**: XP за место/быстрейший круг/отыгранные позиции → рост уровня/дивизиона, сохраняется в БД. Возврат в хаб.
7. В **solo**-режиме доступны пауза и ускорение (2×/6×/12×/24×); в **multiplayer** (≥2 живых игроков) темп залочен в реальном времени, скорость/пауза отключены.

## Полезные скрипты

```bash
pnpm --filter @f1race/race-engine test        # юнит-тесты движка (58)
pnpm --filter @f1race/server test             # WS-интеграция + Room + lobby + persistence + auth + /api (100)
pnpm --filter @f1race/race-engine sim         # прогон гонки в консоли (лог/тюнинг)
pnpm --filter @f1race/race-engine sim:grid    # сравнение билдов навыков героя
pnpm --filter @f1race/race-engine typecheck   # проверки типов движка
pnpm --filter @f1race/web build               # прод-сборка клиента
pnpm --filter @f1race/server load-baseline    # замер пропускной способности (см. docs/load-baseline.md)
```

## Структура

```
packages/race-engine/src
  config.ts           все константы-формулы (темп, шины, бой, старт, XP, дивизионы)
  engine.ts           RaceEngine: real-time шаги, пит-стопы, обгоны, blue-flag yield, snapshot()
  formula.ts          темп, износ, шанс обгона, старт, xpForRace, levelFromXp, divisionForLevel, driverRating, divisionForRating, trainingDurationSec
  tyres.ts            составы шин, сцепление, износ
  track.ts            трассы (Red Bull Ring), 2D-путь для рендера
  skills.ts           навыки и валидация распределения
  qualifying*.ts      квалификация
  factory.ts          сборка драйверов/ботов и RaceConfig

apps/server/src
  server.ts           HTTP (auth + /api routes) + WebSocket, lifecycle
  room.ts             Room: N соединений ↔ драйверы, broadcast, XP/progression на финише
  lobby.ts            очередь + матчмейкинг-тик (по дивизионам, добор ботами); division из driverRating
  start-sequence.ts   lights-out: server-timestamp reaction window, jump-start/late
  protocol.ts         типы сообщений (канонический источник)
  auth/               Yandex OAuth (token exchange, user info) + HMAC session token
  api/http.ts         /api/profile/confirm + /api/training/* (Bearer, lazy completion)
  http-util.ts        общие CORS/sendJson/readJsonBody
  persistence/        DriverProfileRepository + SQLite impl (profiles, race_history, trainings)

apps/web/src
  App.tsx             стейт-машина экранов: landing → onboarding → hub → race (+ /yandex-callback)
  identity.ts         guest UUID + Yandex auth token/profile в localStorage; apiBaseUrl() (origin из VITE_WS_URL)
  api.ts              HTTP-клиент /auth/me + /api/* (Bearer)
  skills.ts           общие метаданные навыков (лейблы/подсказки)
  LandingScreen.tsx   лендинг с кнопкой «Войти через Яндекс»
  HubScreen.tsx       хаб: карточка пилота, навыки, тренировки (таймеры), CTA «Гонка»
  race/SetupScreen.tsx   создание пилота (mode="onboarding" — без резины, гейт первого входа)
  race/RaceView.tsx      экран гонки/лобби (mode-badge, error-toast, progression)
  race/LobbyScreen.tsx   экран ожидания матчмейкинга
  race/StartLights.tsx   светофор-мини-гейм (клик/Space, rAF-анимация)
  race/TrackCanvas.tsx   canvas-рендер трассы и машин
  race/useRaceSession.ts хук: WS-сессия (welcome/snapshot/lobbyState/progression/reconnect)
  race/PitPanel.tsx, Telemetry.tsx, Standings.tsx, QualyBoard.tsx, colors.ts
```

## Архитектурные заметки
- Все вычисления, влияющие на результат, — в `race-engine`, клиент только рендерит (анти-чит-инвариант: онлайн-спорные моменты можно пересчитать офлайн по seed + inputs).
- Модель гонки — real-time по `dt`-тикам (0.1 c). Solo: `speed × tick` шагов за тик; multiplayer: 1 шаг/тик (реальное время).
- Reconnection: слот драйвера (и машина) держится `GRACE_PERIOD_MS` (30 с); `reconnect { sessionToken }` перепривязывает сокет к тому же драйверу. Session-токен лобби/комнаты ≠ `authToken` Яндекса.
- Баланс.field-spread настраивается в `factory.ts` (`paceFactor`, `launchFactor`), цель — без авто-win билдов и без дыр в пелотоне.

## Дорожная карта (из `docs/multiplayer-spec.md`)
Готово: Фазы 0–4 + Фаза 3-persistence + Yandex OAuth + **онбординг/хаб/тренировки/DriverRating (ТЗ «onboarding/progression»)** — мультиплеер, лобби, матчмейкинг, сохранение прогресса, стартовый мини-гейм, фоновая прокачка навыков, двухфакторный рейтинг (вопрос Q5 `level` vs `skillSum` решён).
- **Фаза 5 — кросс-платформа**: вынести `protocol.ts` в общий пакет, PWA/мобильный клиент, delta-snapshot (P7) + клиентская интерполяция (P16) для мобильных сетей.
- **Фаза 6 — контент/RPG**: ещё 2–3 трассы, Q2/Q3 в квалификации, респек скиллов (ТЗ §11 — открытый вопрос).
- Room-state recovery (P10, Redis-снапшот) — пока профили persist'ятся, комнаты — нет.
