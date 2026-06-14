# MENTOR — NMNH

Репозиторий экосистемы **No Money No Honey (NMNH)**: трейдинг‑бот и веб‑платформа торговых сигналов.

На текущем этапе здесь ведётся проектная документация — доработанные технические задания, аудит и
единая архитектура.

## 📚 Документация

Вся документация — в каталоге [`docs/`](docs/README.md):

- [Отчёт о реализации (IMPLEMENTATION)](docs/IMPLEMENTATION.md)
- [Реестр решений (DECISIONS)](docs/DECISIONS.md)
- [Аудит исходных ТЗ](docs/audit/AUDIT.md)
- [Единая архитектура](docs/architecture/unified-core.md)
- [ТЗ Signal Bot](docs/tz/signal-bot-tz.md)
- [ТЗ WebApp](docs/tz/webapp-tz.md)

Начни с [docs/README.md](docs/README.md).

## 🤖 Signal Bot (Фаза 1, в разработке)

Telegram-бот: ментор вводит сигнал → бот считает позицию под баланс каждого ученика → рассылка
(от обычного бота). Реализовано поверх единого ядра `core`. WEEX пока на моках (`WEEX_USE_MOCK=true`).

### Структура кода

```
core/            # единое ядро: calculator, parser, weex, models, templates, settings, repo, db
bot/             # aiogram 3: mentor/, student/, delivery/, scheduler/, services/
tests/           # pytest (61 тест)
```

### Запуск

```bash
pip install -r requirements-dev.txt      # зависимости + dev
cp .env.example .env                      # заполни BOT_TOKEN и ADMIN_TG_ID
python -m bot.main                        # старт бота (mock WEEX)
```

### Тесты

```bash
python -m pytest -q
```

Команды ментора: `/signal` `/students` `/history` `/stats` `/settings`.
Команды ученика: `/start` `/balance` `/active` `/settings` `/help`.
