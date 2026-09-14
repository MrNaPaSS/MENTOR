"""Торговая сводка ученика для мини-аппа академии.

Академия показывает человеку его учёбу, а торгует он у нас. Чтобы в её разделе
появились его собственные цифры - сколько сделок, с каким итогом, на каких
биржах, - она спрашивает их здесь.

Ходит сервер академии, а не браузер ученика, поэтому проверка та же, что у
начисления монет: общий секрет в заголовке `X-Service-Key`. Отдавать чужой PnL
по одному номеру телеграма без ключа нельзя - его знает любой, кто был с
учеником в одном чате.

Что здесь считается правдой. Журнал терминала - это сделки, которые вёл наш
терминал: у них известны цена входа, выхода, комиссия и итог. Сделки, сделанные
руками в приложении биржи, сюда не попадают, и сводка их не увидит. Поэтому в
ответе есть `source`: раздел академии обязан подписать, что показывает
торговлю через терминал, иначе ученик с ручной торговлей на бирже решит, что
цифры врут.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from backend.api.coins import require_service_key
from backend.config import BackendConfig
from backend.deps import get_config, get_session
from backend.trading import journal_stats as stats
from backend.trading.accounts import accounts_of
from core import repo
from core.models import iso, ScalpTrade, Student

router = APIRouter(
    prefix="/api/academy/trading",
    tags=["academy"],
    dependencies=[Depends(require_service_key)],
)

# Потолок выборки. Скальпер делает десятки сделок в день, за год их набираются
# тысячи; считать сводку по всем разом значит держать их все в памяти. Берём
# самые свежие и честно помечаем ответ `truncated`, а не молча врём итогом.
MAX_ROWS = 5000

# Что показывает раздел: сделки через наш терминал, а не всю торговлю на бирже.
SOURCE = "terminal_journal"


def _find(session, tg_id: int | None, weex_uid: str | None) -> Student | None:
    """Ученик по любому ключу связки.

    Заводить здесь некого: сводка - это чтение. Ученика создают начисление
    монет и подтверждение счёта, и пустой ответ вместо новой записи оставляет
    базу чистой от тех, кто просто открыл раздел.
    """
    if tg_id is not None:
        found = session.execute(
            select(Student).where(Student.tg_id == tg_id)
        ).scalar_one_or_none()
        if found is not None:
            return found
    if weex_uid and weex_uid.strip():
        # По всем написаниям номера: бот академии до переделки приписывал к
        # нему префикс, и точное сравнение своего же ученика не находит.
        return repo.get_student_by_weex_uid(session, weex_uid.strip())
    return None


def _empty(days: int, since: datetime, site_url: str, **over) -> dict:
    """Ответ без торговли: нули, а не отказ.

    Ученик, который ещё не торговал, - обычное состояние, и раздел академии
    должен нарисовать ему приглашение, а не ошибку.
    """
    body = {
        "exists": False,
        "student_id": None,
        "tg_id": None,
        "weex_uid": None,
        "created_via": None,
        "first_login_at": None,
        "has_keys": False,
        "has_trades": False,
        "days": days,
        "since": since.isoformat(),
        "source": SOURCE,
        "truncated": False,
        "cabinet_url": f"{site_url}/app/journal",
        "summary": stats.summarize([]),
        "by_day": [],
        "by_exchange": [],
        "top_symbols": [],
        "last_trades": [],
    }
    body.update(over)
    return body


@router.get("/summary")
def trading_summary(
    tg_id: int | None = None,
    weex_uid: str | None = None,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(stats.DEFAULT_LAST, ge=1, le=50),
    session=Depends(get_session),
    config: BackendConfig = Depends(get_config),
):
    """Сводка по торговле ученика за последние `days` дней.

    Ученика ищем по любому ключу связки - `tg_id` или `weex_uid`. Неизвестный
    ученик и ученик без сделок отвечают одинаково спокойно: `exists` и
    `has_trades` отличают эти случаи друг от друга, а числа в обоих нулевые.
    """
    if tg_id is None and not weex_uid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нужен tg_id или weex_uid")

    since = datetime.now(timezone.utc) - timedelta(days=days)
    site_url = (config.site_url or "").rstrip("/")

    student = _find(session, tg_id, weex_uid)
    if student is None:
        return _empty(days, since, site_url)

    rows = session.execute(
        select(ScalpTrade)
        .where(ScalpTrade.student_id == student.id)
        .where(ScalpTrade.closed_at >= since)
        .order_by(ScalpTrade.closed_at.desc())
        .limit(MAX_ROWS + 1)
    ).scalars().all()

    truncated = len(rows) > MAX_ROWS
    trades = rows[:MAX_ROWS]

    known = {
        "exists": True,
        "student_id": student.id,
        "tg_id": student.tg_id,
        "weex_uid": student.weex_uid,
        "created_via": student.created_via or "bot",
        # Пусто - в кабинет ни разу не заходил. Хороший повод позвать его туда
        # прямо из мини-аппа.
        "first_login_at": iso(student.first_login_at),
        "has_keys": bool(accounts_of(session, student.id, connected_only=True)),
        "has_trades": bool(trades),
        "truncated": truncated,
    }

    if not trades:
        return _empty(days, since, site_url, **known)

    return {
        **_empty(days, since, site_url, **known),
        "summary": stats.summarize(trades),
        "by_day": stats.by_day(trades),
        "by_exchange": stats.by_exchange(trades),
        "top_symbols": stats.top_symbols(trades),
        "last_trades": stats.last_trades(trades, limit),
    }
