"""Метка брокера в идентификаторе заявки.

Биржа считает оборот брокера по метке, которую он ставит в каждую заявку: у
WEEX это префикс ``b-{brokerId}`` в ``newClientOrderId``. Метка — единственное,
что связывает сделку трейдера с NMNH, и ставится она в одном месте, внутри
клиента биржи, а не по местам вызова: пропущенный вызов — это оборот, за
который биржа не заплатит.

Снимать метку так же важно, как ставить. Сопровождение узнаёт свои заявки по
началу строки (`backend/trading/watcher.py`), и заявка, вернувшаяся с биржи с
приписанным префиксом, для него чужая — позиция осталась бы без переноса стопа
и без записи в журнал.

Пока идентификатор брокера не задан, метки нет вовсе: класс возвращает всё как
есть, и поведение терминала не отличается от нынешнего.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger("nmnh.broker.tag")

# Столько символов WEEX отводит под newClientOrderId вместе с меткой.
WEEX_LIMIT = 64

# А столько - под clientAlgoId условной заявки: вдвое меньше. Брокерская
# команда WEEX подтвердила 12 сентября 2026, что стопы и цели засчитываются и
# метку надо класть именно сюда. До этого ответа условные заявки уходили без
# метки, и это была половина оборота терминала мимо ребейта.
WEEX_ALGO_LIMIT = 32

# Поля, в которых биржа возвращает наш же идентификатор. Имена разные в разных
# ручках: у обычных заявок одно, у условных другое, в исполнениях третье.
MARK_FIELDS = ("clientOid", "clientOrderId", "newClientOrderId", "clientAlgoId")


@dataclass(frozen=True)
class BrokerMark:
    """Префикс брокера и предел длины идентификатора на этой бирже.

    Пустой префикс означает «метки нет»: так работает биржа, на которой NMNH
    ещё не брокер, и так же — выключенная настройка.
    """

    prefix: str
    limit: int

    @property
    def enabled(self) -> bool:
        return bool(self.prefix)

    def tag(self, client_order_id: str) -> str:
        """Пометить идентификатор заявки.

        Если с меткой идентификатор не влезает в предел биржи, заявка уходит
        без метки. Обрезать нельзя: по этому идентификатору сопровождение потом
        находит свою заявку, и укороченный хвост означает потерянную позицию.
        Потерять ребейт с одной заявки дешевле, чем потерять саму заявку.
        """
        if not self.prefix or not client_order_id:
            return client_order_id
        if client_order_id.startswith(self.prefix):
            return client_order_id

        marked = f"{self.prefix}{client_order_id}"
        if len(marked) > self.limit:
            logger.warning(
                "Заявка уходит без метки брокера: %s символов при пределе %s",
                len(marked),
                self.limit,
            )
            return client_order_id
        return marked

    def untag(self, value: str) -> str:
        """Снять метку — вернуть идентификатор в том виде, в каком его знает терминал."""
        text = str(value or "")
        if self.prefix and text.startswith(self.prefix):
            return text[len(self.prefix):]
        return text

    def clean(self, row: dict) -> dict:
        """Снять метку во всех полях ответа биржи, не трогая исходный словарь."""
        if not self.prefix or not isinstance(row, dict):
            return row

        changed = {
            name: self.untag(str(row[name]))
            for name in MARK_FIELDS
            if row.get(name)
        }
        changed = {name: value for name, value in changed.items() if value != row[name]}
        return {**row, **changed} if changed else row


NO_MARK = BrokerMark(prefix="", limit=WEEX_LIMIT)


def weex_algo_mark(broker_id: str | None) -> BrokerMark:
    """Метка для условной заявки: тот же префикс, но предел вдвое короче.

    Из-за предела ярлык нашей защиты обязан быть коротким: `b-WEEX123456-`
    занимает тринадцать знаков из тридцати двух. Длинный ярлык уйдёт без метки
    (см. `tag`) - заявка встанет, ребейта за неё не будет.
    """
    broker = (broker_id or "").strip()
    if not broker:
        return NO_MARK
    return BrokerMark(prefix=f"b-{broker}-", limit=WEEX_ALGO_LIMIT)


def weex_mark(broker_id: str | None) -> BrokerMark:
    """Метка WEEX: ``b-WEEX123456-`` перед нашим идентификатором заявки.

    Формат из документации брокерского API: идентификатор брокера — «WEEX» и
    шесть цифр, а ``newClientOrderId`` обязан начинаться с ``b-{brokerId}``.
    """
    broker = (broker_id or "").strip()
    if not broker:
        return NO_MARK
    return BrokerMark(prefix=f"b-{broker}-", limit=WEEX_LIMIT)
