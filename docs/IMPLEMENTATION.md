# NMNH — Отчёт о реализации (Фаза 1: Signal Bot)

> Что реализовано в коде, как устроено, как запускать и какие тесты покрывают логику.
> Документ отражает состояние разработки: Фаза 1 (Telegram-бот) + начало Фазы 2 (бэкенд FastAPI),
> поверх единого ядра, WEEX на моках. Связанные документы: [решения](DECISIONS.md),
> [архитектура](architecture/unified-core.md), [ТЗ бота](tz/signal-bot-tz.md), [ТЗ веба](tz/webapp-tz.md).

## Кратко

Реализованы: **Telegram Signal Bot** (`aiogram 3`), **бэкенд-API** (`FastAPI`) и **фронтенд**
(`Next.js 14`) — всё поверх **единого ядра `core`**. Покрытие тестами:
**161 Python-тест (~95% покрытие)** + **10 фронтенд-тестов (Vitest)**, все зелёные. WEEX по умолчанию
на моках (`WEEX_USE_MOCK=true`); **реальный клиент реализован** (HMAC + HTTP) и включается ключами.
**Код входа доставляется в Telegram** через бота (контракт A-10).

## Структура проекта

```
core/                       # единое ядро (переиспользуется ботом и будущим вебаппом)
├── settings/               # Settings: параметры расчёта (Decimal, дефолты из ТЗ §4.4)
├── calculator/             # формулы (formulas.py) + движок (engine.py)
├── parser/                 # гибкий парсер сигнала (RU/EN)
├── weex/                   # base (интерфейс) + mock + real (HMAC-заготовка) + фабрика
├── models/                 # SQLAlchemy: students, signals, signal_deliveries, settings
├── templates/              # рендер сообщений RU/EN + форматтеры
├── db.py                   # подключение PostgreSQL/SQLite
└── repo.py                 # CRUD + идемпотентная доставка + загрузка/seed настроек

bot/                        # Telegram-бот (aiogram 3)
├── config.py               # конфиг из .env
├── keyboards.py            # инлайн-клавиатуры
├── middlewares/auth.py     # фильтр доступа ментора (по Telegram ID)
├── services/signal_service.py   # резолв сигнала + расчёт под учеников (чистая логика)
├── delivery/sender.py      # рассылка от обычного бота, идемпотентно
├── mentor/handlers.py      # команды и поток сигнала ментора
├── student/handlers.py     # онбординг и команды ученика
├── scheduler/balance_sync.py    # APScheduler: синхронизация балансов
└── main.py                 # точка входа (polling)

backend/                    # бэкенд-API (FastAPI) — начало Фазы 2
├── config.py               # конфиг (JWT, TTL, auth)
├── security.py             # JWT HS256 на стандартной библиотеке
├── schemas.py              # Pydantic-схемы запросов/ответов
├── deps.py                 # зависимости: сессия, weex, текущий пользователь/ментор
├── api/                    # auth, market, signals, stats, students
├── ws/                     # WebSocket: ConnectionManager + роуты (/ws, /ws/prices)
├── price_collector.py      # серверный сборщик цен + фан-аут (A-12)
└── main.py                 # фабрика приложения (create_app, lifespan) + точка входа

webapp/                     # фронтенд (Next.js 14 App Router + Tailwind) — Фаза 2
├── app/                    # page.tsx (лендинг), login/, app/dashboard/
├── components/             # LiveStats, Calculator, Leaderboard
├── lib/api.ts              # типизированный клиент бэкенда
└── tailwind.config.ts      # палитра NMNH (ТЗ §10.1)

tests/                      # pytest — 78 тестов
```

## Что реализовано

### Ядро `core`

- **Калькулятор** (`core/calculator`): формулы-канон маржи (`1.8·bal^0.55` / `min(1.2·bal^0.6,150)`),
  **адаптивный турбо-стоп** `min(turbo_sl, buffer·100/плечо)` (решение A-11 — стоп всегда до
  ликвидации), расчёт позиции/риска/тейков/RR, учёт LONG/SHORT, валидация плеча, guardrail
  минимального ордера (статус `skipped`), предупреждения риска (A-04). Всё на `Decimal`.
- **Парсер** (`core/parser`): разбор свободного формата (ТЗ §7) — тикер, направление, плечо
  (`x20`/`20х`/`плечо 20`), вход (по ключевому слову и «голым» числом), стоп, тейки (с индексом и
  по порядку), тип маржи и входа; русские/английские ключевые слова; пометка найдено/авто.
- **WEEX-клиент** (`core/weex`): интерфейс `WeexClient`, `MockWeexClient` (детерминированные цены,
  свечи, баланс реферала по UID, мин. ордер), `RealWeexClient` (HMAC SHA256 + Base64 — заготовка под
  ключи, A-01), фабрика по `WEEX_USE_MOCK`.
- **Модель данных** (`core/models`, `core/db`): единая схема `students / signals /
  signal_deliveries / settings`; деньги — `Numeric` (A-09), время — `TIMESTAMPTZ` UTC (A-07);
  уникальный индекс доставки `(signal_id, student_id)` (идемпотентность A-06). Работает на
  PostgreSQL (канон) и SQLite (dev).
- **Репозиторий** (`core/repo`): CRUD учеников/сигналов, фильтр аудитории, идемпотентная запись
  доставки, загрузка и seed настроек (единый источник A-05).
- **Шаблоны** (`core/templates`): рендер сообщений умеренного/турбо на RU/EN (ТЗ §9), кнопка
  «Войти в сделку» с авто-URL WEEX, форматтеры денег/цен.

### Бот `bot`

- **Ментор:** поток `/signal` на FSM — ввод текста → превью разобранного сигнала (найдено/авто) →
  выбор аудитории `[Всем/Умеренным/Турбо]` с количеством → расчёт под каждого ученика → подтверждение
  → отправка → отчёт о доставке. Плюс `/students`, `/history`, `/stats`, `/settings`, аппрув/реджект
  заявок учеников инлайн-кнопками. Доступ — только по Telegram ID ментора (ТЗ §13).
- **Ученик:** онбординг на FSM (язык → режим → риск % для умеренного → WEEX UID с проверкой через
  аффилиат-API), команды `/balance`, `/active`, `/settings`, `/help`. Заявка нового ученика уходит
  ментору на подтверждение (ТЗ §8.1).
- **Доставка** (`bot/delivery`): от обычного бота (решение A-02), с задержкой между отправками,
  идемпотентной записью и отчётом (sent/failed/skipped).
- **Планировщик** (`bot/scheduler`): периодическая синхронизация балансов; при недоступности —
  fallback на последнее значение с пометкой `manual` (A-01).

### Бэкенд `backend` (начало Фазы 2)

REST-API на FastAPI поверх того же ядра — основа для веб-платформы (ТЗ §15):

- **Рынок/калькулятор:** `GET /api/market/price/{symbol}`, `POST /api/market/calculate`
  (тот же калькулятор, что в боте).
- **Сигналы:** `GET /api/signals`, `/api/signals/active`, `/api/signals/{id}`; **ментор** —
  `POST /api/signals` (создать из текста: парс+резолв+расчёт под аудиторию+WS `new_signal`),
  `PATCH /api/signals/{id}/close`.
- **Профиль ученика:** `GET/PATCH /api/profile`, `GET /api/profile/balance` (обновить с WEEX),
  `GET /api/analytics/me`.
- **Статистика:** `GET /api/stats/public`, `/api/stats/leaderboard`.
- **Авторизация (контракт A-10):** `POST /api/auth/request-code` (UID → код, проверка через WEEX),
  `/api/auth/verify` (код → JWT), `/api/auth/refresh`, `/api/auth/mentor-login`. JWT — HS256 на
  стандартной библиотеке (access 15 мин / refresh 30 дней, ТЗ §4.2).
- **Ученики (только ментор):** `GET/PATCH /api/students`, `/approve`, `DELETE` — за JWT с ролью `mentor`.
- **Реалтайм (A-12):** WebSocket `/ws/prices` (публичный канал цен) и `/ws?token=` (авторизованный
  канал событий — `new_signal`, `balance_update` и т.д.). Серверный **сборщик цен** следит за
  символами активных сигналов и раздаёт `price_update` через WebSocket; клиенты не ходят на биржу.
- `GET /api/health` — проверка живости (+ число WS-клиентов).

Запуск: `uvicorn backend.main:app` (или `python -m backend.main`). Документация Swagger — `/docs`.

### Фронтенд `webapp` (Next.js 14, начало Фазы 2)

Next.js 14 (App Router) + TypeScript + Tailwind с палитрой NMNH (ТЗ §10.1). Подключён к бэкенду
через типизированный клиент `lib/api.ts` (`NEXT_PUBLIC_API_URL`). Реализовано:

- **Лендинг (`/`):** hero, лайв-статистика (из `/api/stats/public`), рабочий **калькулятор**
  (вызывает `/api/market/calculate` — те же формулы ядра), лидерборд, футер с дисклеймером.
- **Логин (`/login`):** двухшаговый вход WEEX UID → код (с auth-flow бэкенда; в dev код
  подсказывается).
- **Кабинет (`/app/dashboard`):** реальные данные — профиль, баланс, аналитика, активные сигналы.
- **Лента сигналов (`/app/signals`):** список сигналов со статусами и кнопкой «Войти в сделку».
- **Панель ментора (`/admin`):** вход по паролю, создание сигнала из текста с расчётом под
  аудиторию, список учеников.
- **Авторизация:** `lib/auth.ts` (хранение токенов), `lib/api.ts` (авторизованные вызовы).

Сборка `npm run build` проходит (4 роута, типы валидны). Запуск:

```bash
cd webapp
npm install
cp .env.local.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev                          # http://localhost:3000 (нужен запущенный бэкенд)
```

## Как запустить

```bash
pip install -r requirements-dev.txt     # зависимости + dev (pytest)
cp .env.example .env                     # заполнить BOT_TOKEN и ADMIN_TG_ID
python -m bot.main                       # старт бота (mock WEEX)
```

По умолчанию БД — локальный SQLite (`DATABASE_URL=sqlite:///nmnh_dev.sqlite3`), WEEX — мок.
Для прод-режима: `DATABASE_URL=postgresql+psycopg://...`, `WEEX_USE_MOCK=false` + ключи WEEX.

## Как запустить бэкенд

```bash
pip install -r requirements-dev.txt
cp .env.example .env          # задать JWT_SECRET (и MENTOR_PASSWORD для веб-панели)
uvicorn backend.main:app --reload    # API на http://localhost:8000, Swagger на /docs
```

## Тесты

**Бэкенд/бот/ядро (Python):** 139 тестов, покрытие 95% (`pytest --cov`).
**Фронтенд (Vitest):** 7 тестов.

```bash
python -m pytest -q                                   # 139 тестов
python -m pytest --cov=core --cov=bot --cov=backend   # + покрытие
cd webapp && npm test                                 # 7 фронтенд-тестов
```

### Покрытие по файлам (Python)

| Файл | Тестов | Что проверяет |
|---|---:|---|
| `test_bot_handlers.py` | 23 | флоу ментора (`/signal`→аудитория→отправка, аппрув) и ученика (онбординг, баланс, active) через диспетчер |
| `test_calculator.py` | 20 | формулы маржи, адаптивный стоп, LONG/SHORT, риск/RR, guardrail, предупреждения |
| `test_parser.py` | 14 | минимальный/полный формат, формы плеча, вход/стоп/тейки, RU/EN, ошибки |
| `test_api.py` | 11 | health, price, calculate, stats, сигналы, auth-flow, refresh, доступ ментора |
| `test_api_more.py` | 11 | сигналы (get/list/404), CRUD учеников, edge-cases auth (истёкший код, попытки, refresh) |
| `test_realtime.py` | 9 | ConnectionManager, сборщик цен, lifespan, WebSocket (hello/auth) |
| `test_keyboards.py` | 8 | инлайн-клавиатуры, signal_service (плечо, resolve, reference) |
| `test_weex_mock.py` | 7 | цены, свечи, баланс реферала, мин. ордер |
| `test_weex_real.py` | 5 | HMAC-подпись, заголовки, заглушки, фабрика |
| `test_security.py` | 5 | JWT: roundtrip, подпись, формат, истечение, типы |
| `test_templates.py` | 5 | форматтеры, URL WEEX, рендер RU/EN |
| `test_repo.py` | 5 | настройки, жизненный цикл ученика, аудитория, идемпотентность |
| `test_settings.py` | 4 | дефолты, from_mapping/as_dict, типы |
| `test_delivery.py` | 4 | поток рассылки, фильтр аудитории, skip, идемпотентность |
| `test_bot_imports.py` | 4 | сборка роутеров, фильтр админа, импорт |
| `test_scheduler.py` | 2 | синхронизация балансов + fallback `manual` |
| `test_bot_main.py` | 2 | setup_database, guard на отсутствие токена |

### Фронтенд (`webapp/__tests__`, Vitest)

| Файл | Тестов | Что проверяет |
|---|---:|---|
| `api.test.ts` | 4 | клиент: POST calculate, GET stats, обработка ошибок, auth |
| `Calculator.test.tsx` | 3 | рендер формы, расчёт по клику (mock fetch), показ ошибки |

## Решения ТЗ, отражённые в коде

| Решение | Где в коде |
|---|---|
| A-11 формулы-канон + адаптивный стоп | `core/calculator/formulas.py`, `engine.py` |
| A-11 guardrail мин. ордера | `core/calculator/engine.py`, `bot/delivery/sender.py` |
| A-02 доставка от обычного бота | `bot/delivery/sender.py` |
| A-01 баланс реферала + fallback manual | `core/weex`, `bot/scheduler/balance_sync.py` |
| A-06 идемпотентность доставки | `core/models` (unique), `core/repo.record_delivery` |
| A-09 деньги в Decimal/Numeric | весь `core` |
| A-05 единый источник настроек | `core/settings`, `core/repo.load_settings` |
| A-15 шаблоны RU/EN | `core/templates` |

## Доставка кода и реальный WEEX (Фаза 2)

- **Код входа в Telegram (A-10):** `backend/notify.py` — `TelegramNotifier` шлёт код через Bot API
  (`BOT_TOKEN`) на `tg_id` ученика; `NullNotifier` для dev (+ `AUTH_EXPOSE_CODES`). Подключён в
  `POST /api/auth/request-code`.
- **Реальный WEEX (`core/weex/real.py`):** HTTP через aiohttp, HMAC-подпись для аффилиат/аккаунт,
  защитный парсинг ответов; публичные цены/свечи/время без подписи. Включается `WEEX_USE_MOCK=false`
  + ключи. Закрытый эндпоинт баланса реферала — настраиваемый путь/поле (`WEEX_AFFILIATE_BALANCE_PATH`),
  т.к. схему предоставляет менеджер WEEX.

## Что на моках / следующие шаги

- **WEEX на моках** — реальные вызовы в `core/weex/real.py` (подпись готова, нужны ключи и точная
  схема закрытого аффилиат-эндпоинта баланса, A-01).
- Доработка `/settings` (редактирование параметров ментором и учеником).
- Миграции БД (Alembic) для прод-PostgreSQL вместо `create_all`.
- Фаза 2 — веб-платформа поверх того же ядра `core`.
