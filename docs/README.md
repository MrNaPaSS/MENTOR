# NMNH — Документация

Документация по экосистеме **No Money No Honey (NMNH)**: трейдинг‑бот и веб‑платформа.
Здесь лежат доработанные технические задания, аудит исходных ТЗ и описание единой архитектуры.

## Навигация

| Документ | Описание |
|---|---|
| [next.md](next.md) | **Что делаем дальше** - начатое и назначенное, чтобы не вспоминать с нуля |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | **Отчёт о реализации** — что написано в коде, структура, запуск, все тесты |
| [DECISIONS.md](DECISIONS.md) | **Реестр решений** — все принятые решения в одной таблице с обоснованием |
| [audit/AUDIT.md](audit/AUDIT.md) | Аудит исходных ТЗ: находки, severity, рекомендации, статусы правок |
| [architecture/database.md](architecture/database.md) | **База данных**: что есть сейчас, чем мешает SQLite, порядок переезда на Postgres |
| [architecture/unified-core.md](architecture/unified-core.md) | Единая архитектура: общее ядро, модель данных, контракты, roadmap |
| [tz/signal-bot-tz.md](tz/signal-bot-tz.md) | ТЗ NMNH Signal Bot (доработанное, v1.1) |
| [tz/webapp-tz.md](tz/webapp-tz.md) | ТЗ NMNH Platform WebApp (доработанное, v2.1) |
| [tz/telegram-login-tz.md](tz/telegram-login-tz.md) | ТЗ: вход на сайт одноразовым паролем от бота академии |
| [tz/chat-signals-tz.md](tz/chat-signals-tz.md) | ТЗ: заявка из чата становится сигналом, и ответы в чате |
| [tz/market-sources-tz.md](tz/market-sources-tz.md) | ТЗ: источники рыночных данных, платные ручки и свои панели вместо чужих |
| [tz/multi-exchange-tz.md](tz/multi-exchange-tz.md) | ТЗ: мультибиржа в терминале - выбор биржи, подключение счёта, стакан своей биржи |
| [tz/bingx-tz.md](tz/bingx-tz.md) | ТЗ: BingX третьей биржей - адаптер, книга потоком, опознание своих заявок без метки |
| [tz/mexc-tz.md](tz/mexc-tz.md) | ТЗ: MEXC четвёртой биржей - контракты, сторона одним числом, метка заявки; и Binance следом |
| [tz/voice-layer-tz.md](tz/voice-layer-tz.md) | ТЗ: голосовой слой терминала на GPT-Live-1 - **отложено** |
| [tz/video-manual-tz.md](tz/video-manual-tz.md) | ТЗ (отложено): видеомануал и промо-ролики терминала на Recordly |
| [features/scalping.md](features/scalping.md) | Скринер и стакан заявок: источник данных, метрики, лимиты биржи |
| [integrations/okx-api-map.md](integrations/okx-api-map.md) | **Карта API OKX v5**: разделы целиком, что из них наше, находки в нашем коде |
| [integrations/broker-program-plan.md](integrations/broker-program-plan.md) | **План брокерской программы**: ребейт бирж, кэшбэк трейдерам, все биржи, этапы |
| [integrations/bingx-api.md](integrations/bingx-api.md) | BingX: подпись, заявки, книга потоком, приватный поток, метка брокера - до первой строки адаптера |
| [integrations/academy.md](integrations/academy.md) | Связка с академией: монеты за учёбу, баланс, подтверждённые счета, общий секрет |
| [integrations/academy-trading.md](integrations/academy-trading.md) | **Статистика торговли в мини-аппе академии**: ручка сводки, поля, пустые состояния, что показать на экране |
| [marketing/growth-playbook.md](marketing/growth-playbook.md) | **План роста**: оффер, экономика трейдера, модель денег, каналы и аффилиаты - разбор Хормози под наш терминал |
| [marketing/offer-stack.md](marketing/offer-stack.md) | **Упаковка экосистемы**: стек ценности, преимущества скальпинга и дейтрейдинга по шагам сделки, порядок блоков на лендинге |
| [marketing/posting-kit.md](marketing/posting-kit.md) | Площадки для ручных публикаций и готовые тексты под каждую |
| [worklog/2026-09-08-terminal.md](worklog/2026-09-08-terminal.md) | Журнал, комиссия, радио и разметка: что чинилось и почему |
| [worklog/2026-09-08-journal-duplicates.md](worklog/2026-09-08-journal-duplicates.md) | Двойная запись в журнале, комиссия на три четверти, боксы на графике |
| [worklog/2026-09-11-rewards-breakeven-caps.md](worklog/2026-09-11-rewards-breakeven-caps.md) | Награды с получением, стоп в б/у сразу после тейка, предел позиции по плечу, новый «Маркет» и функции за монеты |
| [worklog/2026-09-14-binance-live.md](worklog/2026-09-14-binance-live.md) | Binance живым счётом: условные заявки на своей ручке, новый адрес потока, уборка защиты |
| [worklog/2026-09-14-okx-live.md](worklog/2026-09-14-okx-live.md) | OKX живым счётом: спотовый режим счёта, чужой канал в потоке, проход сделкой |
| [worklog/2026-09-13-multi-exchange.md](worklog/2026-09-13-multi-exchange.md) | Планшет в горизонтали, счета по биржам и OKX второй биржей, нагрузка, подтверждение академией |
| [worklog/2026-09-13-own-book.md](worklog/2026-09-13-own-book.md) | Книга с биржи ученика, приватный поток вместо опроса, вход биржей и витрина бирж |
| [worklog/2026-09-13-bingx.md](worklog/2026-09-13-bingx.md) | BingX третьей биржей: клиент, опознание заявок без метки, книга потоком, приватный поток |
| [worklog/2026-09-14-mexc.md](worklog/2026-09-14-mexc.md) | MEXC четвёртой биржей: контракты вместо монет, сторона одним числом, книга по версиям с догоном коммитами |
| [worklog/2026-09-16-postgres-split-health.md](worklog/2026-09-16-postgres-split-health.md) | Postgres, два процесса, приборная панель бирж, бюджет запросов и кластерная свеча |
| [worklog/2026-09-14-binance.md](worklog/2026-09-14-binance.md) | Binance пятой биржей: защита вторым запросом, протухший ключ потока, кешбэка не будет и это написано прямо |
| [worklog/2026-09-15-audit.md](worklog/2026-09-15-audit.md) | Аудит терминала: SSRF в превью, dev-вход, двойные заявки, пустой стакан, скорость |

## С чего начать читать

1. **[DECISIONS.md](DECISIONS.md)** — все принятые решения в одной таблице (быстрый обзор «что и почему»).
2. **[AUDIT.md](audit/AUDIT.md)** — что было не так в исходных ТЗ и как исправлено
   (сводная таблица находок в начале).
3. **[unified-core.md](architecture/unified-core.md)** — как два продукта сводятся к одному ядру
   (диаграммы, модель данных, поэтапный план).
4. **Доработанные ТЗ** — финальные требования с разделами «Changelog доработки» в конце каждого.

## Ключевые решения

- Единый бэкенд (**FastAPI + PostgreSQL**) и общий пакет `core` для бота и веба — без дублирования
  бизнес‑логики.
- WEEX‑баланс реферала по UID — доступ получен (keystone‑риск снят), ручной баланс остаётся как fallback.
- Способ доставки сообщений — **обычный бот (aiogram)**; userbot Pyrogram исключён из-за риска бана
  аккаунта ([A‑02](audit/AUDIT.md#a-02-userbot-pyrogram--риск-блокировки-личного-аккаунта)).
- Стратегия: Фаза 1 — Signal Bot MVP + ядро → Фаза 2 — WebApp поверх ядра.

> Исходные `.docx` ТЗ были сконвертированы в Markdown и доработаны. Все правки прозрачны и перечислены
> в разделах «Changelog доработки» соответствующих файлов и в аудите.
