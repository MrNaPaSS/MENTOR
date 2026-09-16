"""Живучесть рыночного потока Binance: наш процесс или сеть стола.

Пробник, а не тест. Панель показывает обрывы соединения с биржей, но не
отвечает на главный вопрос: рвётся оно у всех на этой машине или только у
нашего сервера. Разница решает, что чинить - код или сеть.

Поэтому здесь то же самое соединение, что держит терминал, но в отдельном
процессе, который ничего больше не делает: не считает книги, не ходит в базу,
не отвечает терминалу. Если рвётся и здесь - дело в сети стола или в самой
бирже, и код тут ни при чём. Если здесь живёт, а на сервере рвётся - виноваты
мы: скорее всего, обработка сообщений не успевает, и биржа отключает того, кто
не читает.

Соединений два, как в бою: стаканы и лента. У них разная беда - обрыв ленты
книг не трогает, обрыв стаканов рушит их все разом, - и в отчёте они стоят
врозь.

Ключи не нужны: рыночная половина биржи открыта всем.

Запуск из каталога проекта:

    python check_binance_stream.py               # 50 монет, пока не остановят
    python check_binance_stream.py 20 600        # 20 монет, десять минут
    python check_binance_stream.py 20 600 aggTrade  # сжатая лента, для сравнения
    python check_binance_stream.py 50 600 trade 1   # лента одним соединением
"""

from __future__ import annotations

import asyncio
import json
import sys
import time

import aiohttp

WS_BASE = "wss://fstream.binance.com/stream"
TICKERS = "https://fapi.binance.com/fapi/v1/ticker/24hr"

# Как в бою: стакан раз в полсекунды, лента каждой сделкой.
#
# Третьим доводом можно попросить сжатую ленту (`aggTrade`). Она была бы вдвое
# дешевле обычной, но на проверке молчит: соединение поднимается, а сообщений
# не приходит ни одного - и с рабочего стола, и со стороны. Потому и проверяем
# пробником, а не правкой сервера: на бою такая лента оставила бы скринер без
# сделок.
DEPTH_RATE = "500ms"
TAPE_STREAM = "trade"

# Сколько тишины считаем смертью соединения. Те же сроки, что у сервера
# (`backend/scalping/binance.py`): стаканы полусотни монет молчать не могут,
# спящая лента одной монеты может.
STALL_DEPTH = 30.0
STALL_TAPE = 120.0

# На сколько соединений раскладывается лента: столько же, сколько в бою
# (`backend/scalping/binance.py`, TAPE_SOCKETS). Четвёртым доводом можно
# попросить одно соединение и увидеть разницу своими глазами.
TAPE_SOCKETS = 8
DEPTH_SOCKETS = 4

# Как часто печатать сводку.
REPORT_EVERY = 30.0


async def top_symbols(session: aiohttp.ClientSession, count: int) -> list[str]:
    """Самые оборотистые пары: те же, что держит скринер."""
    async with session.get(TICKERS, timeout=aiohttp.ClientTimeout(total=20)) as answer:
        rows = await answer.json()
    usdt = [r for r in rows if str(r.get("symbol", "")).endswith("USDT")]
    usdt.sort(key=lambda r: float(r.get("quoteVolume") or 0), reverse=True)
    return [str(r["symbol"]) for r in usdt[:count]]


class Socket:
    """Одно соединение: считает сообщения, обрывы и их причины."""

    def __init__(self, name: str, streams: list[str], stall: float):
        self.name = name
        self.streams = streams
        self.stall = stall
        self.messages = 0
        self.drops = 0
        self.reasons: dict[str, int] = {}
        self.lived: list[float] = []
        self.opened_at = 0.0

    async def run(self, session: aiohttp.ClientSession) -> None:
        url = f"{WS_BASE}?streams={'/'.join(self.streams)}"
        while True:
            try:
                # Без своего heartbeat, как и на сервере: он сам рвал
                # соединение, когда pong не успевал прийти в его окно.
                async with session.ws_connect(url, heartbeat=None, max_msg_size=0) as ws:
                    self.opened_at = time.monotonic()
                    print(f"  [{self.name}] подключено, потоков {len(self.streams)}")
                    why = await self._read(ws)
                    self._note(why, ws.close_code)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - пробник, причина нужна целиком
                self._note(f"исключение {type(exc).__name__}: {exc}", None)
            await asyncio.sleep(1.0)

    async def _read(self, ws: aiohttp.ClientWebSocketResponse) -> str:
        closing = (
            aiohttp.WSMsgType.CLOSE,
            aiohttp.WSMsgType.CLOSING,
            aiohttp.WSMsgType.CLOSED,
        )
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=self.stall)
            except asyncio.TimeoutError:
                return f"тишина {self.stall:.0f} с"
            if msg.type in closing:
                return f"обрыв {ws.close_code}"
            if msg.type is aiohttp.WSMsgType.ERROR:
                return f"ошибка {msg.data}"
            if msg.type is aiohttp.WSMsgType.TEXT:
                self.messages += 1
                # Разбираем, как сервер: сравнение честное только при той же
                # работе на сообщение.
                try:
                    json.loads(msg.data)
                except ValueError:
                    pass

    def _note(self, why: str, code: int | None) -> None:
        self.drops += 1
        self.reasons[why] = self.reasons.get(why, 0) + 1
        if self.opened_at:
            self.lived.append(time.monotonic() - self.opened_at)
            self.opened_at = 0.0
        print(f"  [{self.name}] обрыв: {why} (код {code})")

    def report(self, seconds: float) -> str:
        rate = self.messages / seconds if seconds > 0 else 0.0
        alive = (
            f"{sum(self.lived) / len(self.lived):.0f} с в среднем"
            if self.lived
            else "ни одного обрыва"
        )
        listed = ", ".join(f"{why}: {n}" for why, n in sorted(self.reasons.items()))
        return (
            f"  [{self.name}] сообщений {self.messages} ({rate:.0f}/с), "
            f"обрывов {self.drops}, жизнь соединения {alive}"
            + (f"\n      причины: {listed}" if listed else "")
        )


async def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 50
    limit = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    tape_stream = sys.argv[3] if len(sys.argv) > 3 else TAPE_STREAM
    fan = max(1, int(sys.argv[4])) if len(sys.argv) > 4 else TAPE_SOCKETS

    print("Живучесть рыночного потока Binance")
    print("Ключи не нужны: рыночная половина биржи открыта всем.\n")

    async with aiohttp.ClientSession() as session:
        symbols = await top_symbols(session, count)
        print(f"Монет: {len(symbols)}, первые - {', '.join(symbols[:5])}\n")

        # Стаканы тоже по нескольким соединениям, как в бою: они легче ленты
        # вдесятеро, но их обрыв дороже - книги всех монет соединения разом
        # остаются без обновлений.
        books = [
            Socket(
                f"стаканы {i + 1}/{DEPTH_SOCKETS}",
                [f"{s.lower()}@depth@{DEPTH_RATE}" for s in symbols[i::DEPTH_SOCKETS]],
                STALL_DEPTH,
            )
            for i in range(DEPTH_SOCKETS)
            if symbols[i::DEPTH_SOCKETS]
        ]
        # Лента по нескольким соединениям: толстый поток рвётся, тонкие живут.
        tapes = [
            Socket(
                f"лента {tape_stream} {i + 1}/{fan}",
                [f"{s.lower()}@{tape_stream}" for s in symbols[i::fan]],
                STALL_TAPE,
            )
            for i in range(fan)
            if symbols[i::fan]
        ]

        started = time.monotonic()
        tasks = [asyncio.create_task(one.run(session)) for one in books + tapes]
        try:
            while True:
                await asyncio.sleep(REPORT_EVERY)
                spent = time.monotonic() - started
                # Рамка простыми чертами: консоль Windows живёт в cp1251, и на
                # символе рамки пробник падал бы прямо на первой сводке.
                print(f"\n--- {spent / 60:.1f} мин ---")
                for one in books + tapes:
                    print(one.report(spent))
                if limit and spent >= limit:
                    break
        except KeyboardInterrupt:
            pass
        finally:
            for task in tasks:
                task.cancel()
            # С пределом: закрытие сокета ждёт прощания с той стороны, а его от
            # оборванного соединения можно не дождаться вовсе. Пробник не
            # должен висеть после того, как всё уже посчитано.
            await asyncio.wait(tasks, timeout=5)

        spent = time.monotonic() - started
        print("\n--- итог ---")
        for one in books + tapes:
            print(one.report(spent))
        print(
            "\nОбрывов нет, а на сервере есть - значит дело в нашем процессе: "
            "скорее всего, разбор сообщений не успевает, и биржа отключает "
            "того, кто не читает.\nОбрывы есть и здесь - значит сеть стола или "
            "сама биржа, и код тут ни при чём."
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        print("\nОстановлено.")
