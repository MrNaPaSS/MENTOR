"""Решения сопровождения видны в консоли стола.

Своей настройки логов у сервера не было, и Python выводил только
предупреждения. Когда сделка пропадала с терминала, в журнале стола не
оставалось ни слова о том, кто и почему её снял: «ждущая сделка снята» и
«позиция закрыта» пишутся информационными строками.
"""

from __future__ import annotations

import logging


def test_trading_decisions_are_printed():
    import backend.main  # noqa: F401 - настройка логов живёт при загрузке модуля

    watcher = logging.getLogger("nmnh.trading.watcher")
    assert watcher.isEnabledFor(logging.INFO)


def test_the_rest_stays_at_warnings():
    """Остальное - как раньше: стакан и рынок не засыпают консоль строками."""
    import backend.main  # noqa: F401

    assert not logging.getLogger("nmnh.scalping.collector").isEnabledFor(logging.INFO)
