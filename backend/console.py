"""Окно сервера на столе: не замирает от мыши и пишет журнал в файл.

Сервер на столе работает в окне консоли Windows, и у этого окна есть режим
быстрого выделения. Стоит выделить в нём текст мышью - например, чтобы
скопировать строки журнала и прислать их, - и консоль встаёт на паузу до Esc,
Enter или правого клика. Встаёт и сам сервер: следующая строка журнала ждёт
окна, а с ней ждёт весь процесс. Терминал у учеников в это время висит, а через
двадцать секунд показывает «сервер обновляется». Живой стол 17 сентября:
«бывает жёстко зависает», и следом «просто лёг сервер» - сразу после того, как
лог копировали из окна.

Поэтому режим выделения в окнах сервера выключаем, а журнал пишем ещё и в файл
(`logs/<роль>.log`): присылать строки можно из файла, не трогая окна вовсе. С
отметкой времени - по ней видно, когда именно что случилось.
"""

from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = ROOT / "logs"

# Флаги режима ввода консоли Windows (SetConsoleMode).
ENABLE_QUICK_EDIT_MODE = 0x0040
ENABLE_EXTENDED_FLAGS = 0x0080
STD_INPUT_HANDLE = -10

# Файл журнала: десять мегабайт, пять старых рядом. Этого хватает на сутки
# с запасом и не забивает диск стола.
LOG_BYTES = 10 * 1024 * 1024
LOG_KEEP = 5


def quick_edit_off(mode: int) -> int:
    """Режим ввода без быстрого выделения. Флаг расширенных - иначе не примется."""
    return (mode | ENABLE_EXTENDED_FLAGS) & ~ENABLE_QUICK_EDIT_MODE


def disable_quick_edit() -> bool:
    """Выключить быстрое выделение в окне сервера. True - выключено.

    Не Windows или нет окна консоли (служба, перенаправленный вывод) - ничего не
    делаем: там и замирать нечему.
    """
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(STD_INPUT_HANDLE)
        mode = wintypes.DWORD()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        return bool(kernel32.SetConsoleMode(handle, quick_edit_off(mode.value)))
    except Exception:  # noqa: BLE001 - окно без режима не повод не запуститься
        return False


def log_to_file(role: str, directory: Path = LOG_DIR) -> Path:
    """Писать журнал сервера и в файл `logs/<роль>.log`. Повторный вызов не дублирует."""
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{role or 'all'}.log"
    root = logging.getLogger()
    for handler in root.handlers:
        if isinstance(handler, RotatingFileHandler) and Path(handler.baseFilename) == path:
            return path
    handler = RotatingFileHandler(
        path, maxBytes=LOG_BYTES, backupCount=LOG_KEEP, encoding="utf-8"
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    root.addHandler(handler)
    return path


def prepare(role: str) -> None:
    """Подготовить окно сервера на столе: без паузы от мыши и с файлом журнала."""
    frozen_proof = disable_quick_edit()
    path = log_to_file(role)
    logging.getLogger("nmnh.trading").info(
        "Журнал пишется и в %s%s",
        path,
        "" if frozen_proof else " (быстрое выделение в окне не выключено)",
    )
