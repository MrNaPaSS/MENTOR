"""Интеграционные тесты хендлеров бота через диспетчер (мок-сессия)."""

from decimal import Decimal

import pytest

from core.db import init_engine, create_all, SessionLocal
from core import repo
from core.weex import get_weex_client
from bot.mentor import build_mentor_router
from bot.student import build_student_router
from tests.bot_harness import make_bot, make_dispatcher, feed_message, feed_callback

ADMIN = 100


@pytest.fixture
def env(tmp_path):
    init_engine(f"sqlite:///{tmp_path}/bot.sqlite3")
    create_all()
    with SessionLocal() as s:
        repo.seed_settings(s)
    bot, session = make_bot()
    weex = get_weex_client(use_mock=True)
    dp = make_dispatcher(
        bot, build_mentor_router(ADMIN), build_student_router(ADMIN), weex=weex
    )
    return dp, bot, session


def _approved_student(tg_id, username, mode="moderate", balance="1000"):
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=tg_id, username=username)
        st.is_approved = True
        st.is_active = True
        st.mode = mode
        st.weex_uid = str(tg_id)
        st.balance_usdt = Decimal(balance)
        st.language = "ru"
        s.commit()
        return st.id


# ── Ментор ──

async def test_mentor_stats_empty(env):
    dp, bot, session = env
    await feed_message(dp, bot, ADMIN, "/stats")
    assert any("Статистика" in t for t in session.texts())


async def test_mentor_students_empty(env):
    dp, bot, session = env
    await feed_message(dp, bot, ADMIN, "/students")
    assert any("Учеников пока нет" in t for t in session.texts())


async def test_mentor_settings_and_history(env):
    dp, bot, session = env
    await feed_message(dp, bot, ADMIN, "/settings")
    await feed_message(dp, bot, ADMIN, "/history", update_id=2)
    texts = session.texts()
    assert any("Настройки расчёта" in t for t in texts)
    assert any("История пуста" in t for t in texts)


async def test_non_admin_cannot_use_mentor_commands(env):
    dp, bot, session = env
    # Обычный пользователь шлёт /stats — фильтр ментора не пропускает, ответа «Статистика» нет.
    await feed_message(dp, bot, 999, "/stats")
    assert not any("Статистика" in t for t in session.texts())


async def test_mentor_full_signal_flow(env):
    dp, bot, session = env
    _approved_student(1, "alex", "moderate", "1240")
    _approved_student(2, "max", "turbo", "1800")

    await feed_message(dp, bot, ADMIN, "/signal", update_id=1)
    await feed_message(dp, bot, ADMIN, "XLM LONG\nПлечо 20х", update_id=2)
    await feed_callback(dp, bot, ADMIN, "aud:all", update_id=3)
    await feed_callback(dp, bot, ADMIN, "sig:send", update_id=4)

    # Сигнал создан и доставлен обоим.
    with SessionLocal() as s:
        from sqlalchemy import select, func
        from core.models import Signal, SignalDelivery
        assert s.execute(select(func.count()).select_from(Signal)).scalar_one() == 1
        assert s.execute(select(func.count()).select_from(SignalDelivery)).scalar_one() == 2
    # Ученикам ушли сообщения (send_message к их chat_id).
    assert "SendMessage" in session.method_names()


async def test_mentor_signal_invalid_text(env):
    dp, bot, session = env
    await feed_message(dp, bot, ADMIN, "/signal", update_id=1)
    await feed_message(dp, bot, ADMIN, "просто текст без направления", update_id=2)
    assert any("⚠️" in t for t in session.texts())


async def test_mentor_signal_cancel(env):
    dp, bot, session = env
    await feed_message(dp, bot, ADMIN, "/signal", update_id=1)
    await feed_message(dp, bot, ADMIN, "XLM LONG", update_id=2)
    await feed_callback(dp, bot, ADMIN, "sig:cancel", update_id=3)
    assert any("Отменено" in t for t in session.texts())


async def test_mentor_approve_and_reject(env):
    dp, bot, session = env
    with SessionLocal() as s:
        repo.get_or_create_student(s, tg_id=55, username="newbie")
    await feed_callback(dp, bot, ADMIN, "appr:55", update_id=1)
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=55)
        assert st.is_approved is True
    await feed_callback(dp, bot, ADMIN, "rej:55", update_id=2)
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=55)
        assert st.is_active is False


# ── Ученик ──

async def test_student_start_new_notifies_mentor(env):
    dp, bot, session = env
    await feed_message(dp, bot, 777, "/start")
    texts = session.texts()
    assert any("заявка отправлена" in t.lower() for t in texts)
    # Уведомление ментору тоже ушло (новый ученик).
    assert any("Новый ученик" in t for t in texts)


async def test_student_help(env):
    dp, bot, session = env
    await feed_message(dp, bot, 778, "/help")
    assert any("Команды" in t for t in session.texts())


async def test_student_onboarding_flow(env):
    dp, bot, session = env
    # Создаём одобренного ученика без UID → /start ведёт в онбординг.
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=888, username="stud")
        st.is_approved = True
        s.commit()

    await feed_message(dp, bot, 888, "/start", update_id=1)
    await feed_callback(dp, bot, 888, "lang:ru", update_id=2)
    await feed_callback(dp, bot, 888, "mode:moderate", update_id=3)
    await feed_message(dp, bot, 888, "3", update_id=4)            # риск %
    await feed_message(dp, bot, 888, "888", update_id=5)          # WEEX UID (мок вернёт баланс)

    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=888)
        assert st.weex_uid == "888"
        assert st.balance_usdt is not None
        assert st.risk_percent == Decimal("3")


async def test_student_balance_requires_registration(env):
    dp, bot, session = env
    await feed_message(dp, bot, 901, "/balance")
    assert any("пройдите регистрацию" in t.lower() for t in session.texts())


async def test_student_balance_after_registration(env):
    dp, bot, session = env
    _approved_student(902, "rich", "moderate", "1500")
    await feed_message(dp, bot, 902, "/balance")
    assert any("Баланс" in t for t in session.texts())


async def test_student_active_empty(env):
    dp, bot, session = env
    _approved_student(903, "act", "moderate", "1000")
    await feed_message(dp, bot, 903, "/active")
    assert any("Активных сигналов нет" in t for t in session.texts())


# ── Дополнительные ветки ──

async def test_mentor_students_list(env):
    dp, bot, session = env
    _approved_student(11, "alex", "moderate", "1240")
    await feed_message(dp, bot, ADMIN, "/students")
    assert any("@alex" in t for t in session.texts())


async def test_mentor_history_with_signal(env):
    dp, bot, session = env
    with SessionLocal() as s:
        repo.create_signal(
            s, symbol="XLMUSDT", direction="LONG", leverage=20,
            entry_price=Decimal("0.15"), entry_type="market", margin_type="cross",
            target_audience="all", status="active",
        )
    await feed_message(dp, bot, ADMIN, "/history")
    assert any("XLMUSDT" in t for t in session.texts())


async def test_mentor_audience_without_students(env):
    dp, bot, session = env  # турбо-учеников нет
    await feed_message(dp, bot, ADMIN, "/signal", update_id=1)
    await feed_message(dp, bot, ADMIN, "BTC SHORT", update_id=2)
    await feed_callback(dp, bot, ADMIN, "aud:turbo", update_id=3)
    assert any("Нет учеников" in t for t in session.texts())


async def test_student_settings(env):
    dp, bot, session = env
    _approved_student(910, "s", "turbo", "1000")
    await feed_message(dp, bot, 910, "/settings")
    assert any("Ваши настройки" in t for t in session.texts())


async def test_student_active_with_signal(env):
    dp, bot, session = env
    sid = _approved_student(911, "act2", "moderate", "1000")
    with SessionLocal() as s:
        sig = repo.create_signal(
            s, symbol="ETHUSDT", direction="LONG", leverage=10,
            entry_price=Decimal("3000"), entry_type="market", margin_type="cross",
            target_audience="all", status="active",
        )
        repo.record_delivery(s, sig.id, sid, status="sent")
    await feed_message(dp, bot, 911, "/active")
    assert any("ETHUSDT" in t for t in session.texts())


async def test_student_onboarding_turbo_skips_risk(env):
    dp, bot, session = env
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=920, username="t")
        st.is_approved = True
        s.commit()
    await feed_message(dp, bot, 920, "/start", update_id=1)
    await feed_callback(dp, bot, 920, "lang:en", update_id=2)
    await feed_callback(dp, bot, 920, "mode:turbo", update_id=3)
    await feed_message(dp, bot, 920, "920", update_id=4)  # сразу UID, без риска
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=920)
        assert st.mode == "turbo" and st.weex_uid == "920" and st.language == "en"


async def test_student_onboarding_invalid_risk(env):
    dp, bot, session = env
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=921, username="r")
        st.is_approved = True
        s.commit()
    await feed_message(dp, bot, 921, "/start", update_id=1)
    await feed_callback(dp, bot, 921, "lang:ru", update_id=2)
    await feed_callback(dp, bot, 921, "mode:moderate", update_id=3)
    await feed_message(dp, bot, 921, "abc", update_id=4)   # не число
    await feed_message(dp, bot, 921, "9", update_id=5)     # вне диапазона
    texts = session.texts()
    assert any("от 1 до 5" in t for t in texts)


async def test_student_onboarding_bad_uid(env):
    dp, bot, session = env
    with SessionLocal() as s:
        st = repo.get_or_create_student(s, tg_id=922, username="b")
        st.is_approved = True
        s.commit()
    await feed_message(dp, bot, 922, "/start", update_id=1)
    await feed_callback(dp, bot, 922, "lang:ru", update_id=2)
    await feed_callback(dp, bot, 922, "mode:turbo", update_id=3)
    await feed_message(dp, bot, 922, "404", update_id=4)  # мок вернёт None
    assert any("не найден" in t.lower() for t in session.texts())


async def test_student_start_already_registered(env):
    dp, bot, session = env
    _approved_student(930, "done", "moderate", "1000")  # уже с UID
    await feed_message(dp, bot, 930, "/start")
    assert any("уже зарегистрированы" in t.lower() for t in session.texts())
