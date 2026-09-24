"""Проверки формата .env.example.

Файл читают люди и копируют себе, поэтому ошибка в нём тиражируется на все
серверы разом - и всплывает не при запуске, а много позже, когда мусорное
значение уходит в чужой сервис.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / ".env.example"


def test_pustoe_znachenie_bez_kommentariya_v_toj_zhe_stroke():
    """У пустой переменной комментарий не стоит следом за знаком равенства.

    python-dotenv отрезает комментарий только у непустого значения. Написано
    ``NMNH_BSC_RPC=   # пусто - адрес по умолчанию`` - и значением станет сам
    комментарий. Наблюдатель платежей на таком адресе молча не работает, а
    ключ ИИ-разбора превращается из пустого в мусорный, и ручка отвечает не
    503, а ошибкой похода в Anthropic.
    """
    bad = []
    for number, line in enumerate(EXAMPLE.read_text(encoding="utf-8").splitlines(), 1):
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=\s*#", line):
            bad.append(f"строка {number}: {line.strip()}")
    assert not bad, "комментарий надо перенести на строку выше:\n" + "\n".join(bad)


def test_pustye_peremennye_chitayutsya_pustymi():
    """То же самое, но с другой стороны: глазами самого dotenv."""
    values = dotenv_values(stream=io.StringIO(EXAMPLE.read_text(encoding="utf-8")))
    mussor = {key: value for key, value in values.items() if value and value.startswith("#")}
    assert not mussor, f"значением стал комментарий: {sorted(mussor)}"
