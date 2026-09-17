"""Окно сервера на столе: не замирает от выделения мышью и пишет журнал в файл.

Живой стол 17 сентября: сервер «жёстко зависал» и «лёг» сразу после того, как
лог копировали из окна. В консоли Windows выделение текста мышью ставит окно на
паузу, а с ним и весь процесс сервера.
"""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from backend import console


def test_quick_edit_is_cleared_and_extended_flags_are_set():
    """Без флага расширенных Windows изменение режима не примет."""
    mode = 0x0040 | 0x0001 | 0x0004  # быстрое выделение плюс что-то своё
    new = console.quick_edit_off(mode)
    assert new & console.ENABLE_QUICK_EDIT_MODE == 0
    assert new & console.ENABLE_EXTENDED_FLAGS
    # Прочие флаги окна не трогаем.
    assert new & 0x0001 and new & 0x0004


def test_no_console_is_not_a_reason_to_fail():
    """Служба или перенаправленный вывод: окна нет - и запуск идёт как шёл."""
    assert console.disable_quick_edit() in (True, False)


def test_the_log_goes_to_a_file_with_time_and_only_once(tmp_path):
    root = logging.getLogger()
    before = list(root.handlers)
    try:
        first = console.log_to_file("api", tmp_path)
        second = console.log_to_file("api", tmp_path)
        assert first == second == tmp_path / "api.log"
        ours = [
            h
            for h in root.handlers
            if isinstance(h, RotatingFileHandler) and h.baseFilename == str(first)
        ]
        # Повторный вызов не дублирует строки в файле.
        assert len(ours) == 1

        logging.getLogger("nmnh.trading").warning("Сервер завис на 3.2 с")
        ours[0].flush()
        text = first.read_text(encoding="utf-8")
        assert "Сервер завис на 3.2 с" in text
        # Отметка времени: без неё по файлу не понять, когда это было.
        assert text[:4].isdigit()
    finally:
        for handler in list(root.handlers):
            if handler not in before:
                root.removeHandler(handler)
                handler.close()
