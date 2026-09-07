"""Оповещения о плотности в стакане.

Смысл раздела: сказать о крупной заявке, пока она стоит и пока по ней ещё
можно торговать. Сообщение о том, что цена вчера сходила вниз, торговать не
помогает - поэтому здесь ничего не рассказывается постфактум, кроме одного
случая: когда плиту сняли, не дав по ней исполниться. Это само по себе
сигнал, и молчать о нём хуже, чем сказать.

Три события на жизнь одной полки:

    появилась - в стакане встала заявка от порога и продержалась минуту;
    съели     - цена дошла до неё и прошла насквозь, значит уровень пробит;
    убрали    - заявка исчезла, а цена до неё не дошла: её сняли сами.

Минута выдержки обязательна. Без неё оповещения идут очередью: крупные
заявки мигают в стакане по несколько раз в минуту, и половина из них живёт
доли секунды. Плита, простоявшая минуту, - это намерение, а не рябь.

Данные берём из уже собранного стакана площадки. Своего соединения с биржей
модуль не открывает: книга живёт в ScalpingCollector, и второй поток за теми
же данными был бы лишней нагрузкой и лишним источником расхождений.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from backend.scalping.metrics import Wall
from backend.scalping.state import MarketState, liquidity_shelves

logger = logging.getLogger("nmnh.density")

# За какими инструментами следим. Биткойн первым: на нём плиты крупные и
# осмысленные, на монетах помельче тот же порог не набирается неделями.
DEFAULT_SYMBOLS = ("BTCUSDT",)

# Порог полки: сколько денег должно стоять на уровне.
#
# Пять миллионов - величина, которую видно на биткойне несколько раз в день.
# Ниже двух миллионов уровни становятся рядовыми и оповещения превращаются
# в шум, ради которого раздел и переделывали.
DEFAULT_MIN_NOTIONAL = 5_000_000.0

# Полоса вокруг цены, в которой ищем. Дальше сорока базисных пунктов заявка
# для скальпера бесполезна: цена туда за сессию может и не дойти.
BAND_BP = 40.0

# Сколько плита должна простоять, прежде чем о ней скажем
HOLD_SECONDS = 60.0

# Заявку считаем той же самой, пока её объём не изменился сильнее этой доли.
# Полностью неподвижных плит не бывает: их подъедают и доставляют обратно.
SIZE_TOLERANCE = 0.35

# На сколько уровень должен усохнуть, чтобы считать его исчезнувшим
GONE_FRACTION = 0.35

# Как часто смотрим в стакан. Чаще незачем: выдержка всё равно минута.
POLL_SECONDS = 5.0

# Пауза между сообщениями об одном и том же уровне
REPEAT_SECONDS = 1800.0

# Сколько сообщений отдаём за один обход и как часто вообще говорим.
#
# На живом стакане BTC при пороге в пять миллионов набирается по семь полок
# на сторону, и первый же обход выдал четырнадцать сообщений подряд. Это тот
# самый завал, ради ухода от которого раздел и переделывали.
#
# Берём только самую крупную новую полку и держим паузу: за пять минут
# картина стакана успевает смениться, и следующее сообщение будет про другой
# уровень, а не про соседний в той же стопке.
MAX_PER_POLL = 1
QUIET_SECONDS = 300.0

# Шаг склейки уровней.
#
# Заявки размазаны по соседним ценам, и по сырым уровням порог в пять
# миллионов не набирается вовсе - замер по живому стакану BTC: на голых
# уровнях ноль полок, при склейке по доллару ноль, по десять долларов одна,
# по двадцать пять шесть. Двадцать пять и берём: это и есть тот уровень,
# который трейдер видит строкой в стакане, а не набор соседних заявок.
#
# Тот же шаг служит ключом: две заявки в одном шаге - одна полка, и
# подъеденная заявка не считается новой.
PRICE_STEP = 25.0


@dataclass
class Tracked:
    """Полка, за которой следим от появления до исчезновения."""

    symbol: str
    price: float
    side: str
    notional: float
    peak_notional: float
    first_seen: float
    announced: bool = False
    # Доходила ли цена до уровня, пока он стоял. Если нет, а уровень исчез -
    # значит заявку сняли, а не исполнили
    touched: bool = False
    last_message: float = 0.0


@dataclass
class DensityWatcher:
    """Следит за плотностью и отдаёт готовые сообщения.

    Отправку наружу не делает нарочно: кому и куда слать - решает вызывающий,
    а модуль отвечает только за то, что считает по стакану. Так его можно
    проверить тестами, не поднимая ни бота, ни биржу.
    """

    state: MarketState
    symbols: tuple[str, ...] = DEFAULT_SYMBOLS
    min_notional: float = DEFAULT_MIN_NOTIONAL
    band_bp: float = BAND_BP
    step: float = PRICE_STEP
    _tracked: dict[str, Tracked] = field(default_factory=dict)
    # None, а не ноль: ноль означал бы «отправляли в эпоху Unix», и на
    # маленьких отметках времени первое же сообщение глушилось паузой
    _last_sent: float | None = None

    def poll(self, now: float | None = None) -> list[str]:
        """Осмотреть стакан и вернуть сообщения, которые пора отправить."""
        now = now if now is not None else time.time()
        messages: list[str] = []
        candidates: list[tuple[Tracked, str]] = []

        for symbol in self.symbols:
            symbol_state = self.state.get(symbol)
            if symbol_state is None or not symbol_state.book.synced:
                continue

            price = symbol_state.book.mid
            if price <= 0:
                continue

            shelves = liquidity_shelves(
                symbol_state,
                band_bp=self.band_bp,
                min_notional=self.min_notional,
                step=self.step,
            )
            ready, gone = self._update(symbol, price, shelves, now)
            candidates += ready
            messages += gone

        # Паузу держим на весь сторож, а не на инструмент: форуму всё равно,
        # по какой монете пришла третья подряд плита за минуту
        quiet = self._last_sent is not None and now - self._last_sent < QUIET_SECONDS

        if candidates and not quiet:
            # Объявляем только то, что отправляем прямо сейчас.
            #
            # Раньше уровень помечался объявленным при отборе, и придавленное
            # паузой сообщение пропадало насовсем. Откладывать его в очередь
            # тоже нельзя: через пять минут плиты может уже не быть, а мы
            # скажем, что она стоит. Поэтому уровень просто ждёт следующего
            # обхода - и если к тому времени исчез, о нём и не заговорим.
            candidates.sort(key=lambda pair: pair[0].peak_notional, reverse=True)
            for tracked, text in candidates[:MAX_PER_POLL]:
                tracked.announced = True
                tracked.last_message = now
                messages.append(text)

        if quiet or not messages:
            return []

        self._last_sent = now
        return messages

    # ── Внутреннее ──────────────────────────────────────────────────

    def _update(
        self, symbol: str, price: float, shelves: list[Wall], now: float
    ) -> tuple[list, list[str]]:
        """Кандидаты на объявление и сообщения об исчезнувших уровнях."""
        candidates: list[tuple[Tracked, str]] = []
        seen: set[str] = set()

        for shelf in sorted(shelves, key=lambda w: w.notional, reverse=True):
            key = _key(symbol, shelf.price, shelf.side, self.step)
            seen.add(key)
            known = self._tracked.get(key)

            if known is None:
                self._tracked[key] = Tracked(
                    symbol=symbol,
                    price=shelf.price,
                    side=shelf.side,
                    notional=shelf.notional,
                    peak_notional=shelf.notional,
                    first_seen=now,
                )
                continue

            known.notional = shelf.notional
            known.peak_notional = max(known.peak_notional, shelf.notional)

            # Цена подошла вплотную - запоминаем, чтобы отличить исполнение
            # от снятия, когда уровень исчезнет
            if _reached(price, shelf.price, shelf.side):
                known.touched = True

            if not known.announced and now - known.first_seen >= HOLD_SECONDS:
                candidates.append((known, _appeared(known, price)))

        return candidates, self._check_gone(symbol, price, seen, now)

    def _check_gone(
        self, symbol: str, price: float, seen: set[str], now: float
    ) -> list[str]:
        """Уровни, которые были и пропали из стакана."""
        messages: list[str] = []
        dropped: list[str] = []

        for key, known in self._tracked.items():
            if known.symbol != symbol or key in seen:
                continue

            dropped.append(key)
            if not known.announced:
                # О ней и не говорили - молчим и дальше
                continue
            if now - known.last_message < REPEAT_SECONDS:
                continue

            messages.append(_gone(known, price))

        for key in dropped:
            self._tracked.pop(key, None)

        return messages


# ── Тексты ──────────────────────────────────────────────────────────

def _side_word(side: str) -> str:
    return 'покупку' if side == 'bid' else 'продажу'


def _appeared(known: Tracked, price: float) -> str:
    away = abs(known.price - price) / price * 100
    where = 'ниже' if known.side == 'bid' else 'выше'
    return (
        '🧱 <b>{coin}: плита на {side} {money}</b>\n\n'
        'Уровень {level}, это {away}% {where} цены {price}. '
        'Стоит больше минуты.'
    ).format(
        coin=_coin(known.symbol),
        side=_side_word(known.side),
        money=_money(known.notional),
        level=_price(known.price),
        away=_num(away, 2),
        where=where,
        price=_price(price),
    )


def _gone(known: Tracked, price: float) -> str:
    if known.touched:
        return (
            '💥 <b>{coin}: плиту на {level} пробили</b>\n\n'
            'Стояло {money} на {side}, цена прошла насквозь. '
            'Сейчас {price}.'
        ).format(
            coin=_coin(known.symbol),
            level=_price(known.price),
            money=_money(known.peak_notional),
            side=_side_word(known.side),
            price=_price(price),
        )

    return (
        '🎭 <b>{coin}: плиту на {level} сняли</b>\n\n'
        'Стояло {money} на {side}, цена до уровня не дошла - заявку убрали. '
        'Сейчас {price}.'
    ).format(
        coin=_coin(known.symbol),
        level=_price(known.price),
        money=_money(known.peak_notional),
        side=_side_word(known.side),
        price=_price(price),
    )


# ── Мелочи ──────────────────────────────────────────────────────────

def _key(symbol: str, price: float, side: str, step: float = PRICE_STEP) -> str:
    return '{}:{}:{:.0f}'.format(symbol, side, round(price / step))


def _reached(price: float, level: float, side: str) -> bool:
    """Дошла ли цена до уровня"""
    return price <= level if side == 'bid' else price >= level


def _coin(symbol: str) -> str:
    return symbol[:-4] if symbol.endswith('USDT') else symbol


def _money(value: float) -> str:
    if value >= 1_000_000:
        return '{} млн'.format(_num(value / 1_000_000, 1))
    return '{} тыс'.format(_num(value / 1_000, 0))


def _num(value: float, digits: int = 1) -> str:
    return ('{:.' + str(digits) + 'f}').format(value).replace('.', ',')


def _price(value: float) -> str:
    if value >= 1000:
        return '{:,.0f}'.format(value).replace(',', ' ')
    return '{:.2f}'.format(value).replace('.', ',')


async def run_watcher(watcher: DensityWatcher, send) -> None:
    """Крутит опрос и отдаёт сообщения в `send`.

    Ошибку отправки не считаем поводом останавливаться: связь с Telegram
    рвётся куда чаще, чем ломается стакан, а сторож должен пережить обрыв.
    """
    while True:
        try:
            for text in watcher.poll():
                try:
                    await send(text)
                except Exception as e:
                    logger.error("Сообщение не ушло: %s", e)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("Обход стакана сорвался: %s", e)

        await asyncio.sleep(POLL_SECONDS)
