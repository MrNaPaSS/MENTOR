"""Почему у ученика нет раздела «Скальпинг».

Кнопку в меню рисует ответ `/api/profile` — поле `scalping`. Считает его
`backend.deps.scalping_allowed`, и молчаливых причин отказа там ровно три:
UID ментора в базе отличается от того, что знает сервер; список допущенных
пуст; на сервере лежит старая версия файлов, где этой логики ещё нет.

Скрипт отвечает на все три сразу, не поднимая приложение.

Запуск:  python check_scalping.py
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import select

from backend.config import BackendConfig
from backend.deps import scalping_allowed
from core.db import SessionLocal, init_engine
from core.models import Student


def main() -> int:
    # Читаем .env как это делает сервер. Подпись токенов диагностике не нужна,
    # но без ключа конфигурация не собирается — подставляем заглушку, чтобы
    # скрипт отвечал на свой вопрос, а не падал на чужом.
    os.environ.setdefault("JWT_SECRET", "diagnostic")
    config = BackendConfig.from_env()

    print(f"UID ментора (WEEX_MENTOR_UID): {config.mentor_uid or '— не задан —'}")
    print(f"Список допущенных (SCALPING_ALLOWED): {', '.join(config.scalping_allowed) or '— пуст —'}")
    print(f"Сбор стаканов (SCALPING_ENABLED): {'включён' if config.scalping_enabled else 'ВЫКЛЮЧЕН'}")
    print()

    init_engine()
    with SessionLocal() as session:
        students = session.execute(select(Student)).scalars().all()

    if not students:
        print("В базе нет ни одного ученика.")
        return 1

    opened = 0
    for s in students:
        allowed = scalping_allowed(s, config)
        opened += allowed
        mark = "открыт " if allowed else "закрыт "
        print(
            f"{mark} id={s.id:<4} tg={s.tg_id or '—':<12} "
            f"uid={s.weex_uid or '—':<14} {s.username or ''}"
        )

    print()
    print(f"Раздел открыт: {opened} из {len(students)}")
    if opened == 0:
        print(
            "Никому. Сверь UID ментора выше с колонкой uid: "
            "различие даже в пробеле закрывает раздел."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
