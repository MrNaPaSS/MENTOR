"""Правила сопровождения позиции: безубыток и перестановка стопа.

Порт из бота: формулы те же, включая учёт комиссии в безубытке. Вынесено в
чистые функции без сети — это единственная часть торгового модуля, которую
можно проверить тестами до копейки, и именно в ней ошибка стоит денег.
"""

from __future__ import annotations

from dataclasses import dataclass

# Доли позиции, которые забирает каждая цель. Первая снимает треть риска,
# вторая выводит половину, остаток едет до последней: так торгует заказчик.
# Целей другого числа делим поровну — правило написано для лестницы из трёх.
TAKE_SHARES = (0.3, 0.5, 0.2)


def take_share(index: int, count: int) -> float:
    """Доля позиции, которую закрывает цель номер `index` (с нуля)."""
    if count <= 0 or index < 0 or index >= count:
        return 0.0
    if count == len(TAKE_SHARES):
        return TAKE_SHARES[index]
    return 1.0 / count


def takes_covered(closed_fraction: float, count: int) -> int:
    """Сколько целей объясняют такую закрытую долю позиции.

    Доли неравные, поэтому считать делением нельзя: после первой цели закрыто
    30%, после второй 80%. Складываем по порядку с допуском на шаг лота.
    """
    if count <= 0 or closed_fraction <= 0:
        return 0
    total = 0.0
    for i in range(count):
        total += take_share(i, count)
        # Допуск: биржа режет объём по шагу лота, точного равенства не бывает.
        if closed_fraction + 0.02 < total:
            return i
    return count


# Комиссия тейкера по умолчанию. Обе ноги позиции — вход и выход — платят её,
# поэтому в безубытке она считается дважды.
DEFAULT_TAKER_FEE = 0.0004


@dataclass(frozen=True)
class Position:
    symbol: str
    side: str          # long | short
    entry: float
    quantity: float
    stop: float | None = None


def breakeven_price(
    position: Position,
    mark_price: float | None = None,
    fee: float = DEFAULT_TAKER_FEE,
) -> float | None:
    """Цена, при которой позиция закрывается в настоящий ноль.

    Наивный перенос стопа на цену входа гарантирует небольшой убыток на каждом
    «безубытке»: комиссия уплачена на входе и будет уплачена на выходе. Отсюда

        лонг:  (P − вход)·объём = комиссия·вход·объём + комиссия·P·объём
               → P = вход · (1 + комиссия) / (1 − комиссия)
        шорт:  P = вход · (1 − комиссия) / (1 + комиссия)

    Если рынок уже ушёл против позиции дальше этой цены, стоп туда двигать
    нельзя — биржа отклонит его как стоящий не с той стороны от цены, а мы
    сами загоним позицию в убыток. В этом случае возвращается цена входа.
    """
    entry = position.entry
    if not (entry > 0) or not (0 <= fee < 1):
        return None

    if position.side == "long":
        price = entry * (1 + fee) / (1 - fee)
    else:
        price = entry * (1 - fee) / (1 + fee)

    if mark_price is not None and mark_price > 0:
        if position.side == "long" and price >= mark_price:
            return entry
        if position.side == "short" and price <= mark_price:
            return entry
    return price


def should_move_stop(position: Position, new_stop: float) -> bool:
    """Двигать ли стоп на новое место.

    Только в сторону сокращения убытка. Стоп, отодвинутый дальше от цены, —
    это не сопровождение позиции, а увеличение риска задним числом, и
    случайная перестановка в такую сторону не должна проходить вовсе.
    """
    if not (new_stop > 0):
        return False
    if position.stop is None:
        return True
    return new_stop > position.stop if position.side == "long" else new_stop < position.stop


def stop_after_take(
    position: Position,
    takes_hit: int,
    targets: list[float],
    mark_price: float | None = None,
    fee: float = DEFAULT_TAKER_FEE,
) -> float | None:
    """Где должен стоять стоп после взятых целей.

    После первой цели — безубыток. После второй и дальше стоп подтягивается за
    предыдущей целью: сделка, прошедшая две цели, не должна закрываться в ноль.
    Возвращает `None`, когда двигать нечего или некуда.
    """
    if takes_hit <= 0:
        return None

    if takes_hit == 1:
        candidate = breakeven_price(position, mark_price, fee)
    else:
        # Предыдущая взятая цель: за неё и прячем стоп.
        index = min(takes_hit, len(targets)) - 2
        if index < 0:
            return None
        candidate = targets[index]

    if candidate is None or not should_move_stop(position, candidate):
        return None
    return candidate
