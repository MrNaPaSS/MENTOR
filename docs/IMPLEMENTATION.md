# NMNH — Отчёт о реализации (Фаза 1: Signal Bot)

> Что реализовано в коде, как устроено, как запускать и какие тесты покрывают логику.
> Документ отражает состояние разработки: Фаза 1 (Telegram-бот) + начало Фазы 2 (бэкенд FastAPI),
> поверх единого ядра, WEEX на моках. Связанные документы: [решения](DECISIONS.md),
> [архитектура](architecture/unified-core.md), [ТЗ бота](tz/signal-bot-tz.md), [ТЗ веба](tz/webapp-tz.md).

## Кратко

Реализованы: **Telegram Signal Bot** (`aiogram 3`) и **бэкенд-API** (`FastAPI`) — оба поверх
**единого ядра `core`** (калькулятор, парсер, WEEX-клиент, модель данных, шаблоны). Бизнес-логика и
API покрыты тестами: **78 тестов, все зелёные**. WEEX работает на моках (`WEEX_USE_MOCK=true`) —
реальные вызовы подключаются позже без изменения логики.

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
- **Сигналы:** `GET /api/signals`, `/api/signals/active`, `/api/signals/{id}`.
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

```bash
python -m pytest -q          # 78 тестов
```

### Покрытие по файлам

| Файл | Тестов | Что проверяет |
|---|---:|---|
| `test_calculator.py` | 20 | формулы маржи, адаптивный стоп, LONG/SHORT, риск/RR, guardrail, предупреждения |
| `test_parser.py` | 13 | минимальный/полный формат, формы плеча, вход/стоп/тейки, RU/EN, ошибки |
| `test_api.py` | 11 | health, price, calculate, stats, сигналы, auth-flow, refresh, доступ ментора |
| `test_realtime.py` | 6 | ConnectionManager (broadcast/dead), сборщик цен, WebSocket (hello, auth) |
| `test_weex_mock.py` | 7 | цены, свечи, баланс реферала (стабильность/не найден), мин. ордер |
| `test_repo.py` | 5 | настройки (seed/load/update), жизненный цикл ученика, аудитория, идемпотентность |
| `test_templates.py` | 5 | форматтеры, URL WEEX, рендер RU/EN |
| `test_delivery.py` | 4 | полный поток рассылки, фильтр аудитории, skip при малом балансе, идемпотентность |
| `test_bot_imports.py` | 4 | сборка роутеров, фильтр админа, импорт `bot.main` |
| `test_scheduler.py` | 2 | обновление балансов и fallback `manual` |

### Полный список тестов

```
test_calculator.py::test_moderate_margin_matches_formula[200-33.2]
test_calculator.py::test_moderate_margin_matches_formula[1000-80.4]
test_calculator.py::test_moderate_margin_matches_formula[5000-194.9]
test_calculator.py::test_turbo_margin_matches_formula[200-28.8]
test_calculator.py::test_turbo_margin_matches_formula[1000-75.7]
test_calculator.py::test_turbo_margin_matches_formula[2000-114.8]
test_calculator.py::test_turbo_margin_cap_applies_for_large_balance
test_calculator.py::test_turbo_adaptive_stop_below_liquidation[50-0.5]
test_calculator.py::test_turbo_adaptive_stop_below_liquidation[100-0.5]
test_calculator.py::test_turbo_adaptive_stop_below_liquidation[150-0.333…]
test_calculator.py::test_turbo_adaptive_stop_below_liquidation[200-0.25]
test_calculator.py::test_turbo_adaptive_stop_below_liquidation[400-0.125]
test_calculator.py::test_moderate_stop_is_fixed
test_calculator.py::test_moderate_long_full_result
test_calculator.py::test_short_inverts_price_direction
test_calculator.py::test_leverage_above_max_is_clamped_with_warning
test_calculator.py::test_min_order_guardrail_skips
test_calculator.py::test_high_turbo_leverage_triggers_warning
test_calculator.py::test_adaptive_stop_keeps_turbo_risk_bounded
test_calculator.py::test_manual_stop_beyond_liquidation_warns
test_parser.py::test_minimal_signal
test_parser.py::test_full_pair_not_double_suffixed
test_parser.py::test_direction_russian
test_parser.py::test_leverage_forms[XLM LONG x20]
test_parser.py::test_leverage_forms[XLM LONG 20х]
test_parser.py::test_leverage_forms[XLM LONG плечо 20]
test_parser.py::test_entry_by_keyword
test_parser.py::test_bare_number_as_entry
test_parser.py::test_stop_and_takes_full
test_parser.py::test_takes_sequential_without_index
test_parser.py::test_comma_decimal
test_parser.py::test_isolated_margin
test_parser.py::test_invalid_without_direction
test_parser.py::test_empty
test_weex_mock.py::test_factory_returns_mock
test_weex_mock.py::test_price_is_positive
test_weex_mock.py::test_unknown_symbol_has_price
test_weex_mock.py::test_klines_shape
test_weex_mock.py::test_affiliate_balance_stable
test_weex_mock.py::test_affiliate_balance_not_found
test_weex_mock.py::test_min_order
test_repo.py::test_seed_and_load_settings
test_repo.py::test_update_setting
test_repo.py::test_student_lifecycle
test_repo.py::test_audience_filtering
test_repo.py::test_delivery_idempotent
test_delivery.py::test_full_flow_sends_to_audience
test_delivery.py::test_turbo_audience_only
test_delivery.py::test_low_balance_is_skipped
test_delivery.py::test_delivery_idempotent_on_retry
test_scheduler.py::test_sync_updates_balances
test_scheduler.py::test_sync_fallback_to_manual_when_unavailable
test_templates.py::test_fmt_money_thousands
test_templates.py::test_fmt_price_precision
test_templates.py::test_weex_url
test_templates.py::test_render_moderate_ru_contains_key_blocks
test_templates.py::test_render_turbo_en
test_bot_imports.py::test_mentor_router_builds
test_bot_imports.py::test_student_router_builds
test_bot_imports.py::test_is_admin_filter
test_bot_imports.py::test_main_module_imports
```

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

## Что на моках / следующие шаги

- **WEEX на моках** — реальные вызовы в `core/weex/real.py` (подпись готова, нужны ключи и точная
  схема закрытого аффилиат-эндпоинта баланса, A-01).
- Доработка `/settings` (редактирование параметров ментором и учеником).
- Миграции БД (Alembic) для прод-PostgreSQL вместо `create_all`.
- Фаза 2 — веб-платформа поверх того же ядра `core`.
