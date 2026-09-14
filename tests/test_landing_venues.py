"""Лендинг и сервер обязаны обещать одно и то же.

Цифра возврата живёт в трёх местах: сервер отдаёт её кабинету
(`core/venues.py`), бот академии обещает её при регистрации, а лендинг
собирается заранее и держит свой список (`webapp/lib/venues.ts`) - спросить
сервер на сборке он не может.

Расходились они уже: на витрине кабинета стояло 15%, на странице лендинга -
«до 40%». Человек читает обе, и первое же пойманное расхождение стоит дороже
любой цифры. Поэтому здесь сверка: поправили сервер - тест держит лендинг,
пока его не поправили следом.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from core.venues import VENUES

TS = Path(__file__).resolve().parents[1] / "webapp" / "lib" / "venues.ts"

# Строка реестра: { code: "weex", name: "WEEX", trading: true, cashback: 0.15 }
ROW = re.compile(
    r'\{\s*code:\s*"(?P<code>[a-z]+)",\s*'
    r'name:\s*"(?P<name>[^"]+)",\s*'
    r"trading:\s*(?P<trading>true|false),\s*"
    r"cashback:\s*(?P<cashback>null|[0-9.]+)\s*,?\s*\}"
)


def _landing() -> dict[str, dict]:
    """Реестр лендинга как он записан в TypeScript."""
    rows = {}
    for match in ROW.finditer(TS.read_text(encoding="utf-8")):
        raw = match.group("cashback")
        rows[match.group("code")] = {
            "name": match.group("name"),
            "trading": match.group("trading") == "true",
            "cashback": None if raw == "null" else json.loads(raw),
        }
    return rows


def test_реестр_прочитался():
    """Если разметку файла поменяли, сверка ниже молча пройдёт на пустом."""
    rows = _landing()
    assert len(rows) == len(VENUES), f"в {TS.name} разобрано {len(rows)} бирж из {len(VENUES)}"


@pytest.mark.parametrize("venue", VENUES, ids=lambda v: v.code)
def test_лендинг_обещает_то_же(venue):
    row = _landing().get(venue.code)
    assert row is not None, f"биржи {venue.code} нет в {TS.name}"
    assert row["name"] == venue.name
    assert row["trading"] == venue.trading, "торговля на лендинге и на сервере разошлись"
    # Ноль и пусто значат разное: ноль - биржа запрещает возврат, пусто - долю
    # ещё не назвали. Свести их в одно значит либо пообещать несуществующее,
    # либо отнять существующее.
    assert row["cashback"] == venue.cashback, "доля возврата на лендинге и на сервере разошлись"
