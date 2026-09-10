"""Авторизация ученика (UID → код в Telegram → JWT) и ментора (ТЗ §4, контракт A-10).

Доставку кода в Telegram выполняет бот; здесь код генерируется и хранится. В dev-режиме
(``AUTH_EXPOSE_CODES=true``) код возвращается в ответе для удобства тестирования.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import logging
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from core import repo
from core.weex.uid import clean_uid
from backend.config import BackendConfig
from backend.deps import get_config, get_session, get_weex, get_notifier
from backend.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    new_session_id,
    TokenError,
)
from backend.balance_collector import snapshot_student
from backend.trading.funds import balance_by_keys
# Тот же ключ и та же сверка, что у начисления монет: обе ручки открыты одному
# и тому же боту, и второй секрет рядом защиты не добавит.
from backend.api.coins import require_service_key
from backend.schemas import (
    RequestCodeIn, RequestCodeOut, VerifyIn, TokenPair, RefreshIn, DevLoginOut, DevTokens,
    TgCodeIn, TgCodeOut, TgVerifyIn,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def record_login(session, student) -> None:
    """Отметить вход ученика в кабинет.

    ``first_login_at`` остаётся пустым у тех, кто есть в базе, но кабинет ни
    разу не открывал — именно по этому полю в админке видно «не заходил».
    Коммит остаётся за вызывающим: вход и так завершается записью в базу.
    """
    now = _now()
    if student.first_login_at is None:
        student.first_login_at = now
    student.last_login_at = now
    student.login_count = (student.login_count or 0) + 1
    # Один вход на ученика: новая метка закрывает прежнюю сессию. Заводится
    # здесь, потому что через это место проходит каждый вход - и по паролю от
    # бота, и по UID, и дев-вход.
    student.session_key = new_session_id()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _student_tokens(student, config: BackendConfig) -> TokenPair:
    """Пара токенов ученика - с меткой его текущей сессии.

    Метку кладём в оба токена: иначе refresh прежнего устройства продолжал бы
    выписывать себе новые access-токены после чужого входа.
    """
    return TokenPair(
        access_token=create_access_token(
            student.id, "student", config.jwt_secret,
            config.access_ttl_seconds, student.session_key,
        ),
        refresh_token=create_refresh_token(
            student.id, config.jwt_secret, config.refresh_ttl_seconds,
            "student", student.session_key,
        ),
    )


def _uid_login_open(config: BackendConfig) -> None:
    """Пустить, только если вход по одному UID ещё разрешён.

    Вход через бота академии делает Telegram единственным способом попасть в
    кабинет: только через него UID биржи связывается с человеком. Старые ручки
    остаются в коде за флагом, а не удаляются: если у кого-то нет ни `tg_id` в
    записи, ни записи в боте, вернуть ему доступ надо уметь одной переменной, а
    не деплоем посреди ночи.
    """
    if not config.uid_login_enabled:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Вход по UID закрыт: войдите через бота академии",
        )


def _seed_demo(session, demo_student) -> None:
    """Наполнить демо-данными: ученики, сигналы, доставки (для dev-просмотра)."""
    extra = [
        ("alex", "moderate", "1240", True),
        ("sasha", "moderate", "342", True),
        ("max", "turbo", "1800", True),
        ("newbie", "moderate", "0", False),  # ожидает подтверждения
    ]
    for i, (uname, mode, bal, approved) in enumerate(extra, start=1):
        st = repo.get_or_create_student(session, tg_id=900000 + i, username=uname)
        st.weex_uid = f"90000{i}"
        st.mode = mode
        st.is_approved = approved
        st.is_active = approved
        st.balance_usdt = Decimal(bal)
        session.commit()

    sigs = [
        ("BTCUSDT", "LONG", 20, "64000", "63040", "64960", "65920", "66880", "active"),
        ("ETHUSDT", "SHORT", 25, "3200", "3248", "3152", "3104", "3056", "active"),
        ("SOLUSDT", "LONG", 50, "145", "143.5", "147", "149", "151", "closed"),
        ("XRPUSDT", "LONG", 20, "0.52", "0.512", "0.528", "0.536", "0.544", "active"),
    ]
    created = []
    for sym, d, lev, e, sl, t1, t2, t3, status in sigs:
        sig = repo.create_signal(
            session, symbol=sym, direction=d, leverage=lev, entry_price=Decimal(e),
            entry_type="market", margin_type="cross", stop_loss=Decimal(sl),
            tp1=Decimal(t1), tp2=Decimal(t2), tp3=Decimal(t3),
            target_audience="all", status=status,
        )
        created.append(sig)

    # Доставки демо-ученику — чтобы аналитика/дашборд показывали цифры.
    for sig in created[:3]:
        repo.record_delivery(
            session, sig.id, demo_student.id, balance_at_signal=Decimal("1000"),
            margin_usd=Decimal("80"), position_size=Decimal("1600"), risk_usd=Decimal("12"),
            status="sent", delivered_at=_now(),
        )


def _uid(raw: str | None) -> str:
    """UID из ввода - цифрами.

    Ученик копирует опознаватель из приложения биржи, и вместе с цифрами
    приезжает всё, что стоит рядом: пробел, дефис, буквенный префикс. Биржа на
    такое отвечает отказом, а в отчёте партнёрской программы UID лежит числом -
    и ученик с прилипшим префиксом оставался без баланса и оборота вовсе.

    Цифр не нашлось - возвращаем что прислали: пусть на отказ ответит проверка,
    а не молчание.
    """
    return clean_uid(raw) or (raw or "").strip()


@router.post("/request-code", response_model=RequestCodeOut)
async def request_code(
    body: RequestCodeIn,
    config: BackendConfig = Depends(get_config),
    weex=Depends(get_weex),
    session=Depends(get_session),
    notifier=Depends(get_notifier),
):
    _uid_login_open(config)
    uid = _uid(body.weex_uid)
    # UID должен существовать в WEEX и принадлежать одобренному ученику.
    balance = await weex.get_affiliate_balance(uid)
    if balance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UID не найден в системе WEEX")
    student = repo.get_student_by_weex_uid(session, uid)
    if student is None or not student.is_approved:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Обратитесь к ментору для получения доступа")

    code = f"{secrets.randbelow(10**6):06d}"
    repo.create_auth_code(session, uid, code, config.code_ttl_seconds)

    # Доставка кода в Telegram через бота (контракт A-10).
    delivered = False
    if student.tg_id:
        delivered = await notifier.send_message(
            int(student.tg_id), f"🔑 Код входа в NMNH Platform: {code}"
        )
    detail = (
        "Код отправлен в Telegram бот"
        if delivered
        else "Откройте @nmnh_bot и нажмите /start, затем запросите код снова"
    )
    return RequestCodeOut(
        ok=True,
        detail=detail,
        code=code if config.expose_codes else None,
    )


@router.post("/verify", response_model=TokenPair)
def verify(
    body: VerifyIn,
    config: BackendConfig = Depends(get_config),
    session=Depends(get_session),
):
    _uid_login_open(config)
    uid = _uid(body.weex_uid)
    row = repo.get_active_auth_code(session, uid)
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Код не запрашивался")

    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if _now() > expires:
        repo.delete_auth_code(session, uid)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Код истёк. Запросите новый.")

    if row.attempts >= config.max_code_attempts:
        repo.delete_auth_code(session, uid)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Превышено число попыток")

    if not secrets.compare_digest(row.code, body.code.strip()):
        row.attempts += 1
        session.commit()
        left = config.max_code_attempts - row.attempts
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Неверный код. Осталось попыток: {left}")

    student = repo.get_student_by_weex_uid(session, uid)
    if student is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ученик не найден")

    repo.delete_auth_code(session, uid)
    record_login(session, student)
    session.commit()
    return _student_tokens(student, config)


@router.post("/login-by-uid", response_model=TokenPair)
async def login_by_uid(
    body: RequestCodeIn,
    config: BackendConfig = Depends(get_config),
    session=Depends(get_session),
    weex=Depends(get_weex),
):
    """Вход по WEEX UID: если аффилиат ментора — авто-регистрация и выдача токенов."""
    _uid_login_open(config)
    from core.models import Student as StudentModel

    uid = _uid(body.weex_uid)
    student = repo.get_student_by_weex_uid(session, uid)

    # Всегда проверяем WEEX: подтверждаем аффилиат и получаем актуальный баланс.
    balance = await weex.get_affiliate_balance(uid)
    if balance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "UID не найден в системе WEEX")

    if student is None:
        student = StudentModel(
            weex_uid=uid, is_approved=True, is_active=True,
            balance_usdt=balance, balance_source="affiliate_api",
            created_via="web",
        )
        session.add(student)
    else:
        student.is_approved = True
        student.is_active = True
        # Баланс по ключам ученика, если они уже подключены.
        #
        # UID здесь проверяется ради самого аффилиата - без него в кабинет не
        # пускают, - но записывать его цифру поверх живой нельзя: вход в
        # кабинет затирал бы то, что ученик видит в приложении биржи, оценкой
        # со стороны. Ключей нет - по UID, как и раньше.
        own = await balance_by_keys(session, student)
        student.balance_usdt = own if own is not None else balance
        student.balance_source = "api_keys" if own is not None else "affiliate_api"
    session.flush()
    record_login(session, student)
    session.commit()
    session.refresh(student)

    # Снимок баланса за сегодня (для PnL-календаря в аналитике).
    await snapshot_student(weex, student.id, uid)

    return _student_tokens(student, config)


# ── Вход одноразовым паролем от бота академии ───────────────────────────────

logger = logging.getLogger("nmnh.auth")

# Алфавит пароля без похожих начертаний: ни I, ни O, ни нуля с единицей.
# Пароль набирают руками с экрана телефона, и «O или 0» - это не опечатка
# ученика, а наша ошибка.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LEN = 8

# Что выбрасываем при вводе: человек не обязан помнить, где черта и какой
# регистр. Всё, кроме букв и цифр, - оформление.
_NOISE = re.compile(r"[^A-Z0-9]")


def _make_code() -> str:
    """Новый пароль. 32^8 - около сорока бит, перебор упирается в ограничитель."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))


def _pretty(code: str) -> str:
    """Пароль для показа: с чертой посередине его легче прочесть и набрать."""
    half = len(code) // 2
    return f"{code[:half]}-{code[half:]}"


def _normalize(code: str) -> str:
    return _NOISE.sub("", code.strip().upper())


def _digest(code: str) -> str:
    """Хеш пароля. В базе лежит он, а не сам пароль."""
    return hashlib.sha256(_normalize(code).encode("utf-8")).hexdigest()


def _aware(at: datetime | None) -> datetime:
    """Время из базы - всегда с зоной.

    SQLite хранит дату строкой и пояс теряет. Наивную дату `timestamp()` считает
    по местному времени, и срок пароля уезжал на разницу поясов: у нас он
    оказывался истёкшим в тот же миг, как его выдали.
    """
    if at is None:
        return _now()
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


@router.post("/tg/code", response_model=TgCodeOut)
async def tg_code(
    body: TgCodeIn,
    request: Request,
    _: None = Depends(require_service_key),
    config: BackendConfig = Depends(get_config),
    session=Depends(get_session),
    weex=Depends(get_weex),
):
    """Выдать боту одноразовый пароль для его ученика.

    Пропуск проверяет бот - он единственный, кто знает, подтверждён ли счёт.
    Здесь только выдача: пришёл с сервисным ключом и с UID - значит проверку
    уже прошёл.

    Повторный запрос до истечения срока отдаёт **тот же** пароль и не продлевает
    его. Ученик нажал кнопку дважды - он ждёт один пароль, а не гадает, какой из
    двух рабочий.
    """
    uid = _uid(body.weex_uid)
    if not uid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нужен weex_uid")

    # Счёт выдач - по ученику, а не по адресу: ходит бот, и адрес у всех
    # запросов один. Ограничитель живёт на приложении, а не на функции: на
    # функции он был бы общим на весь процесс и не знал бы про настройки.
    limiter = getattr(request.app.state, "tg_code_limiter", None)
    if limiter is not None and not limiter.allow(f"tg:{body.tg_id}"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Слишком часто. Попробуйте позже."
        )

    # Аффилиата спрашиваем здесь, а не на вводе: там ученик ждёт ответа, и
    # лишний поход на биржу заметен. Биржа не ответила - пароль всё равно
    # выдаём: связь с ней рвётся, а вход из-за этого падать не должен, и
    # отметки бота в этом случае достаточно.
    try:
        await weex.get_affiliate_balance(uid)
    except Exception as exc:  # noqa: BLE001 - причина в журнале, вход важнее
        logger.warning("UID %s при выдаче пароля не проверен: %s", uid, exc)

    # Ученика заводим и связываем сразу, а не при вводе: тогда пароль,
    # доехавший до сайта, уже находит кого впустить, и связка UID с Telegram
    # не зависит от того, дошёл ли ученик до формы.
    student = _link_student(session, body.tg_id, uid, body.username.strip())
    _save_avatar(student, body.avatar)
    session.commit()

    # Пока пароль жив, повторный запрос отдаёт **тот же** и не продлевает срок.
    #
    # Ученик нажал кнопку дважды - он ждёт один пароль. Выдать второй и погасить
    # первый нельзя: первый он мог уже скопировать, и тот умрёт у него в руках -
    # это ровно то непонимание, которого мы избегаем.
    #
    # В базе лежит только хеш, поэтому сам пароль на время его жизни держим в
    # памяти процесса. Она переживает пять минут, а дамп базы - годы: то, ради
    # чего заведён хеш, этим не нарушается. Перезапустился сервер - кеш пуст,
    # ученик просит заново и получает новый.
    cache = getattr(request.app.state, "tg_code_cache", None)
    alive = repo.active_tg_code(session, body.tg_id)
    if alive is not None and cache is not None:
        kept = cache.get(body.tg_id)
        left = int((_aware(alive.expires_at) - _now()).total_seconds())
        if kept and _digest(kept) == alive.code_hash and left > 0:
            return TgCodeOut(code=_pretty(kept), expires_in=left)

    fresh = _make_code()
    repo.create_tg_code(session, body.tg_id, _digest(fresh), config.tg_code_ttl_seconds)
    if cache is not None:
        cache[body.tg_id] = fresh

    logger.info("Пароль входа выдан ученику tg=%s", body.tg_id)
    return TgCodeOut(code=_pretty(fresh), expires_in=config.tg_code_ttl_seconds)


# Куда кладём аватарки. Рядом с прочими загрузками: их уже раздаёт этот же
# сервер по /uploads, и заводить второе место незачем.
_AVATARS = Path(__file__).parent.parent.parent / "webapp" / "public" / "uploads" / "avatars"

# Полмегабайта. Аватарка Telegram - это картинка на сто шестьдесят точек;
# всё, что заметно больше, прислано не ботом или прислано зря.
_AVATAR_MAX = 512 * 1024

_AVATAR_URL = re.compile(r"^data:image/(png|jpe?g);base64,", re.IGNORECASE)


def _save_avatar(student, payload: str) -> None:
    """Сохранить аватарку ученика, если бот её прислал.

    Ошибки глотаем молча с записью в журнал: аватарка - украшение подписи, и
    ронять из-за неё выдачу пароля нельзя. Пустая строка ничего не затирает: в
    Telegram аватарки может не быть или она закрыта настройками, и подставлять
    вместо неё пустоту значит стереть ту, что была.
    """
    if not payload or student is None:
        return
    head = _AVATAR_URL.match(payload)
    if head is None:
        logger.warning("Аватарка ученика %s не в том виде", student.id)
        return
    try:
        raw = base64.b64decode(_AVATAR_URL.sub("", payload.strip()), validate=True)
    except (binascii.Error, ValueError):
        logger.warning("Аватарка ученика %s не читается", student.id)
        return
    if not raw or len(raw) > _AVATAR_MAX:
        logger.warning("Аватарка ученика %s не того размера: %d", student.id, len(raw))
        return

    kind = "png" if head.group(1).lower() == "png" else "jpg"
    try:
        _AVATARS.mkdir(parents=True, exist_ok=True)
        name = f"{student.tg_id}.{kind}"
        (_AVATARS / name).write_bytes(raw)
    except OSError as exc:
        logger.warning("Аватарка ученика %s не сохранена: %s", student.id, exc)
        return

    # Метка времени в адресе: файл перезаписывается под тем же именем, и без
    # неё браузер показывал бы старую картинку из кеша.
    student.avatar_url = f"/uploads/avatars/{name}?v={int(_now().timestamp())}"


def _link_student(session, tg_id: int, weex_uid: str, username: str):
    """Найти ученика по любому из ключей, завести при отсутствии и связать оба.

    Ник пишем **всегда**, а не только при заведении: в Telegram его меняют, а
    он потом стоит в подписи на карточке сделки и в углу снимка графика.
    Пустой ник ничего не затирает - в Telegram он не обязателен, и у части
    учеников его нет вовсе.
    """
    from core.models import Student as StudentModel

    student = repo.get_student_by_weex_uid(session, weex_uid)
    if student is None:
        student = session.query(StudentModel).filter(StudentModel.tg_id == tg_id).one_or_none()

    if student is None:
        student = StudentModel(
            tg_id=tg_id,
            weex_uid=weex_uid,
            username=username or None,
            created_via="academy",
        )
        session.add(student)
    else:
        # Второй ключ мог появиться позже - дописываем, чтобы две записи на
        # одного человека не разошлись.
        if student.tg_id is None:
            student.tg_id = tg_id
        if not student.weex_uid:
            student.weex_uid = weex_uid
        if username:
            student.username = username

    # Счёт подтвердил бот - той самой отметкой, по которой он открывает курсы.
    # Источник другой, чем у входа по UID, факт тот же.
    student.is_approved = True
    student.is_active = True
    session.flush()
    return student


@router.post("/tg/verify", response_model=TokenPair)
def tg_verify(
    body: TgVerifyIn,
    config: BackendConfig = Depends(get_config),
    session=Depends(get_session),
):
    """Впустить по одноразовому паролю.

    Причину неудачи не уточняем. «Пароль истёк» и «пароля нет» - разные ответы
    для того, кто перебирает, и одинаковые для того, кто просто ошибся.
    """
    from core.models import Student as StudentModel

    tg_id = repo.take_tg_code(session, _digest(body.code))
    if tg_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пароль не подошёл")

    student = session.query(StudentModel).filter(StudentModel.tg_id == tg_id).one_or_none()
    if student is None:
        # Ученика заводит выдача пароля, и к этому моменту он есть всегда.
        # Если его нет - расходится не вход, а база; молчать об этом нельзя.
        logger.error("Пароль погашен, а ученика tg=%s нет", tg_id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пароль не подошёл")

    record_login(session, student)
    session.commit()
    return _student_tokens(student, config)


@router.post("/refresh", response_model=TokenPair)
def refresh(
    body: RefreshIn,
    config: BackendConfig = Depends(get_config),
    session=Depends(get_session),
):
    """Обновить пару токенов.

    Метку сессии здесь проверяем, а не заводим новую: обновление - это
    продолжение того же входа, а не вход. Без проверки правило «один вход на
    ученика» ничего бы не значило: устройство, вытесненное чужим входом,
    продолжало бы выписывать себе свежие access-токены по старому refresh.
    """
    from core.models import Student as StudentModel

    try:
        payload = decode_token(body.refresh_token, config.jwt_secret)
    except TokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужен refresh-токен")
    sub = payload["sub"]
    # У токенов, выданных до появления роли в refresh, её нет — определяем по sub.
    role = payload.get("role") or ("mentor" if sub == "mentor" else "student")

    sid = payload.get("sid")
    if role == "student":
        student = session.get(StudentModel, int(sub))
        if student is None or not student.is_active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
        # Пустая метка в записи - вход, сделанный до появления правила: такой
        # токен доживает свой срок, а первый новый вход заводит метку.
        if student.session_key and sid != student.session_key:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Вход выполнен на другом устройстве"
            )

    return TokenPair(
        access_token=create_access_token(
            sub, role, config.jwt_secret, config.access_ttl_seconds, sid
        ),
        refresh_token=create_refresh_token(
            sub, config.jwt_secret, config.refresh_ttl_seconds, role, sid
        ),
    )


@router.post("/dev-login", response_model=DevLoginOut)
def dev_login(config: BackendConfig = Depends(get_config), session=Depends(get_session)):
    """Dev-вход без кода/пароля: выдаёт токены ментора и демо-ученика (только не в проде).

    Создаёт демо-ученика и демо-сигнал, чтобы кабинет был наполнен для просмотра.
    """
    if not config.dev_login:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Dev-вход отключён (прод-режим)")

    student = repo.get_student_by_weex_uid(session, "999999")
    first_run = student is None
    if first_run:
        student = repo.get_or_create_student(session, tg_id=999999, username="dev_student")
        student.weex_uid = "999999"
        student.is_approved = True
        student.is_active = True
        student.mode = "moderate"
        student.balance_usdt = Decimal("1000")
        session.commit()

    # Богатый демо-сид — чтобы кабинет/админка были «живыми».
    from sqlalchemy import select, func
    from core.models import SignalDelivery
    has_deliveries = session.execute(
        select(func.count()).select_from(SignalDelivery).where(SignalDelivery.student_id == student.id)
    ).scalar_one() > 0
    if not has_deliveries:
        _seed_demo(session, student)

    record_login(session, student)
    session.commit()

    return DevLoginOut(
        mentor=DevTokens(
            access_token=create_access_token("mentor", "mentor", config.jwt_secret, config.access_ttl_seconds),
            # Ментору тоже нужен refresh: иначе админку выбрасывает через 15 минут.
            refresh_token=create_refresh_token("mentor", config.jwt_secret, config.refresh_ttl_seconds, "mentor"),
        ),
        student=DevTokens(
            access_token=create_access_token(
                student.id, "student", config.jwt_secret,
                config.access_ttl_seconds, student.session_key,
            ),
            refresh_token=create_refresh_token(
                student.id, config.jwt_secret, config.refresh_ttl_seconds,
                "student", student.session_key,
            ),
        ),
        student_username=student.username or "dev_student",
    )


class MentorLoginBody(BaseModel):
    password: str


@router.post("/mentor-login", response_model=TokenPair)
def mentor_login(body: MentorLoginBody, config: BackendConfig = Depends(get_config)):
    """Вход ментора по паролю (MVP). В проде — отдельные креды/2FA."""
    expected = os.getenv("MENTOR_PASSWORD", "")
    if not expected or not secrets.compare_digest(body.password, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный пароль")
    return TokenPair(
        access_token=create_access_token("mentor", "mentor", config.jwt_secret, config.access_ttl_seconds),
        refresh_token=create_refresh_token("mentor", config.jwt_secret, config.refresh_ttl_seconds, "mentor"),
    )
