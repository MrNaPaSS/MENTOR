"""Витрина бирж: условия, способ подключения и состояние партнёрства.

Ученик приходит в академию со счётом на одной из бирж или без счёта вовсе, и
первый его вопрос - «где заводить и что я с этого получу». До сих пор ответ
жил в переписке: какие биржи мы поддерживаем, где комиссия ниже, где идёт
кешбэк, где счёт подключается входом, а где ключами. Здесь он лежит одним
списком, и отдаётся терминалу ручкой `/api/exchanges`.

Что здесь **есть** и чего намеренно **нет**:

* ставки - **справочные, публичные**, для нулевого уровня VIP и в долях
  единицы (0.0006 - это 0.06%). Настоящая ставка счёта у каждого своя, её
  считает сервер по закрытым сделкам (`backend/api/trading.py`, `taker_fee`), и
  она всегда важнее справочной;
* доля возврата (`cashback`) - та, которую академия **уже обещает ученику** в
  боте при регистрации. Цифры обязаны совпадать до знака: человек читает их
  сначала в боте, потом в терминале, и расхождение он заметит первым делом.
  Меняются они вместе с текстом бота, а не по отдельности;
* ставка через академию (`academy_taker`) - пока `None` у всех: биржи не
  назвали сниженную ставку, возврат идёт с обычной. Витрина пишет «условия
  уточняются». Обещать скидку, которой нет, дороже, чем промолчать: обещание
  ученик запомнит, а оговорку - нет;
* состояние партнёрства - из плана программы
  (`docs/integrations/broker-program-plan.md`, §3): `talks` - переговоры идут,
  `applied` - заявка подана, `live` - брокерский ID получен и метка работает.

Порядок в списке - порядок на витрине: сперва те, где уже можно торговать.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.exchanges import TITLES

# Состояния брокерской программы.
TALKS = "talks"       # переговоры, брокерского ID нет
APPLIED = "applied"   # заявка подана, ждём ответа
LIVE = "live"         # ID получен, заявки уходят с меткой

# Способы подключения счёта.
KEYS = "keys"         # ключи API руками
OAUTH = "oauth"       # вход биржей, без ввода ключей


@dataclass(frozen=True)
class Venue:
    """Биржа на витрине: что ученик увидит до того, как что-то подключит."""

    code: str
    name: str
    # Торгует ли терминал на ней уже сегодня.
    trading: bool
    # Идёт ли книга с этой биржи. Иначе стакан общий, с Binance.
    book: bool
    # Способы подключения счёта, в порядке предпочтения.
    connect: tuple[str, ...]
    # Состояние брокерской программы.
    broker: str
    # Справочные ставки фьючерсов, доли единицы. `None` - не подтверждена.
    taker: float | None = None
    maker: float | None = None
    # Ставка через академию и доля кешбэка - только когда условия получены.
    academy_taker: float | None = None
    cashback: float | None = None

    @property
    def title(self) -> str:
        return TITLES.get(self.code, f"{self.name} Futures")

    @property
    def oauth(self) -> bool:
        return OAUTH in self.connect


# Биржи по порядку витрины. Ставки - публичные справочные для нулевого уровня.
VENUES: tuple[Venue, ...] = (
    Venue(
        code="weex",
        name="WEEX",
        trading=True,
        book=False,       # публичного потока WEEX у нас нет, см. ТЗ §4.4
        connect=(OAUTH, KEYS),
        broker=TALKS,
        taker=0.0008,
        maker=0.0002,
        # Столько комиссии возвращается ученику академии. Та же цифра стоит в
        # боте академии на экране регистрации - расходиться им нельзя.
        cashback=0.15,
    ),
    Venue(
        code="okx",
        name="OKX",
        trading=True,
        book=True,        # своя книга и лента, backend/scalping/okx_collector.py
        connect=(OAUTH, KEYS),
        broker=TALKS,
        taker=0.0005,
        maker=0.0002,
        cashback=0.10,
    ),
    Venue(
        code="bingx",
        name="BingX",
        # Академия приводит на неё учеников по своей ссылке и подтверждает
        # счета; с сентября 2026 терминал на ней и торгует (core/bingx).
        trading=True,
        book=True,        # своя книга и лента, backend/scalping/bingx_collector.py
        connect=(KEYS,),
        broker=TALKS,
        taker=0.0005,
        maker=0.0002,
        cashback=0.10,
    ),
    Venue(
        code="mexc",
        name="MEXC",
        # Партнёрство получено, ключи проверены на живой бирже; с сентября
        # 2026 терминал на ней торгует (core/mexc).
        trading=True,
        book=True,        # своя книга и лента, backend/scalping/mexc_collector.py
        connect=(KEYS,),
        broker=TALKS,
        # Лучшие ставки из четырёх бирж, из справочника самой биржи. Для
        # скальпинга, где комиссия съедает больше стопа, разница решающая.
        taker=0.0002,
        maker=0.0,
        # Долю возврата называет партнёрский менеджер, и пока он молчит,
        # витрина пишет «условия уточняются». Выдуманный процент ученик
        # запомнит, а оговорку - нет (ТЗ MEXC, §6).
        cashback=None,
    ),
    Venue(
        code="bybit",
        name="Bybit",
        trading=False,
        book=False,
        connect=(KEYS,),
        broker=TALKS,
    ),
    Venue(
        code="bitget",
        name="Bitget",
        trading=False,
        book=False,
        connect=(KEYS,),
        broker=TALKS,
    ),
    Venue(
        code="binance",
        name="Binance",
        # С 14 сентября 2026 терминал торгует и здесь (core/binance). Рыночная
        # половина работала в бою с самого начала: с неё идут скринер и книга
        # всем, у кого своя биржа не подключена.
        trading=True,
        book=True,
        connect=(KEYS,),
        broker=TALKS,
        taker=0.0005,
        maker=0.0002,
        # Ноль - это не «не знаем», а «не будет»: Binance запрещает партнёрам
        # возвращать комиссию пользователям и урезает за это ставку, а
        # засчитывает только новых пользователей без чужого реф-кода. Ученик
        # обязан прочитать это на витрине, а не выяснить после регистрации
        # (ТЗ MEXC, §9). Пустое поле здесь читалось бы как «условия
        # уточняются» - то есть как обещание, которого мы дать не можем.
        cashback=0.0,
    ),
)

BY_CODE: dict[str, Venue] = {venue.code: venue for venue in VENUES}


def venue(code: str | None) -> Venue | None:
    return BY_CODE.get((code or "").strip().lower())


def tradable() -> tuple[Venue, ...]:
    """Биржи, на которых терминал уже торгует."""
    return tuple(v for v in VENUES if v.trading)


def as_dict(one: Venue) -> dict:
    """Витрина наружу. Числа как есть, подписи - у клиента, в его языке."""
    return {
        "exchange": one.code,
        "name": one.name,
        "title": one.title,
        "trading": one.trading,
        "book": one.book,
        "connect": list(one.connect),
        "broker": one.broker,
        "taker": one.taker,
        "maker": one.maker,
        "academy_taker": one.academy_taker,
        "cashback": one.cashback,
    }
