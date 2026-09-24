"""Проверка ключей WEEX по живой бирже.

Пробник, а не тест. Кабинет на неподошедший ключ отвечает одной строкой -
«Ключи не подошли» - и по ней не отличить опечатку в passphrase от сбитых
часов сервера или ключа, выданного только на чтение. Здесь видно, что
ответила сама биржа: её код ошибки и текст, без нашего перевода.

Проверяется три вещи, в порядке того, как часто они оказываются виноваты:

1. **часы сервера.** Подпись запроса включает метку времени, и биржа
   отвергает запрос, разошедшийся с её часами. На свежеустановленном
   сервере время не синхронизировано, пока не запущена служба времени, и
   ошибка приходит такая же невнятная, как при неверном ключе;
2. **ответ биржи на баланс** - тот самый запрос, которым кабинет проверяет
   ключ при подключении;
3. **право торговли.** Баланс читается и ключом «только чтение», поэтому
   успех второго шага ещё не значит, что ключом можно поставить заявку.

Заявок пробник не ставит и ничего не меняет.

Запуск из каталога проекта:

    python check_weex.py КЛЮЧ СЕКРЕТ ПАРОЛЬ

Либо ключами из окружения, если они заданы в .env:

    set WEEX_CHECK_KEY=...
    set WEEX_CHECK_SECRET=...
    set WEEX_CHECK_PASSPHRASE=...
    python check_weex.py

Ключи никуда не отправляются, кроме самой биржи, и в вывод не попадают.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 - старый поток, обойдёмся как есть
    pass

import aiohttp  # noqa: E402

from core.weex.futures import BASE_URL, Credentials, WeexFutures, WeexTradeError  # noqa: E402

# Насколько часы могут разойтись, чтобы биржа ещё принимала подпись. У WEEX
# окно порядка тридцати секунд; предупреждаем раньше, чтобы причина нашлась
# до того, как запросы начнут отваливаться через раз.
CLOCK_WARN_SECONDS = 5.0


async def check_clock(session: aiohttp.ClientSession) -> None:
    """Сверить часы сервера с часами биржи.

    Время берём из заголовка ответа: отдельной ручки времени у WEEX нет, а
    заголовок есть у любого ответа и приходит от её же серверов.
    """
    print("1. Часы сервера")
    try:
        async with session.get(f"{BASE_URL}/capi/v2/market/time") as resp:
            header = resp.headers.get("Date", "")
    except Exception as exc:  # noqa: BLE001 - пробник, причина важнее типа
        print(f"   биржа не ответила вовсе: {exc}")
        return

    if not header:
        print("   биржа не назвала своё время - пропускаем проверку")
        return

    theirs = parsedate_to_datetime(header).astimezone(timezone.utc)
    ours = datetime.now(timezone.utc)
    drift = (ours - theirs).total_seconds()
    print(f"   сервер:  {ours:%Y-%m-%d %H:%M:%S} UTC")
    print(f"   биржа:   {theirs:%Y-%m-%d %H:%M:%S} UTC")
    if abs(drift) > CLOCK_WARN_SECONDS:
        print(f"   РАСХОЖДЕНИЕ {drift:+.0f} с - биржа отвергнет подпись.")
        print("   Лечится синхронизацией времени:")
        print("     Set-Service w32time -StartupType Automatic")
        print("     Start-Service w32time")
        print("     w32tm /resync /force")
    else:
        print(f"   расхождение {drift:+.1f} с - в пределах нормы")


async def check_balance(probe: WeexFutures) -> bool:
    """Тот же запрос, которым кабинет проверяет ключ при подключении."""
    print("\n2. Баланс по ключам")
    try:
        data = await probe.balance()
    except WeexTradeError as exc:
        print(f"   биржа отказала: {exc}")
        code = getattr(exc, "code", None)
        if code is not None:
            print(f"   код ошибки биржи: {code}")
        print("\n   Что это обычно значит:")
        print("   - неверный passphrase: восстановить нельзя, ключ пересоздают;")
        print("   - ключ привязан к другому адресу: сверьте белый список IP;")
        print("   - ключ удалён или выдан на другом счёте.")
        return False
    except Exception as exc:  # noqa: BLE001 - пробник, причина важнее типа
        print(f"   запрос не дошёл: {type(exc).__name__}: {exc}")
        return False

    print(f"   ответ получен: {data}")
    return True


async def check_trade_right(probe: WeexFutures) -> None:
    """Баланс читается и ключом без права торговли - спрашиваем отдельно."""
    print("\n3. Право торговли")
    ask = getattr(probe, "can_trade", None)
    if ask is None:
        print("   биржа такого не сообщает - пропускаем")
        return
    try:
        allowed = await ask()
    except WeexTradeError as exc:
        print(f"   не удалось узнать: {exc}")
        return
    if allowed is False:
        print("   ключ выдан только на чтение - заявки им не поставить")
    else:
        print("   торговля ключу разрешена")


async def main() -> int:
    args = sys.argv[1:]
    if len(args) >= 3:
        api_key, secret, passphrase = args[0], args[1], args[2]
    else:
        api_key = os.getenv("WEEX_CHECK_KEY", "") or os.getenv("WEEX_API_KEY", "")
        secret = os.getenv("WEEX_CHECK_SECRET", "") or os.getenv("WEEX_SECRET_KEY", "")
        passphrase = os.getenv("WEEX_CHECK_PASSPHRASE", "") or os.getenv("WEEX_PASSPHRASE", "")

    if not (api_key and secret and passphrase):
        print("Ключи не заданы. Передайте их доводами командной строки:")
        print("    python check_weex.py КЛЮЧ СЕКРЕТ ПАРОЛЬ")
        print("или задайте WEEX_CHECK_KEY, WEEX_CHECK_SECRET, WEEX_CHECK_PASSPHRASE.")
        return 2

    print(f"Биржа: {BASE_URL}")
    print(f"Ключ:  ...{api_key[-6:]} (длина {len(api_key)})")
    print(f"Пароль ключа: задан, длина {len(passphrase)}\n")

    async with aiohttp.ClientSession() as session:
        await check_clock(session)

        async def factory():
            return session

        probe = WeexFutures(Credentials(api_key, secret, passphrase), factory)
        if await check_balance(probe):
            await check_trade_right(probe)
            print("\nКлюч рабочий: кабинет примет его.")
            return 0

    print("\nКлюч биржа не приняла - причина выше.")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
