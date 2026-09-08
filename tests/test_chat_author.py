"""Подпись автора в ленте чата.

Сигналы и разбор идут от школы, а не от личного телеграма наставника: ник в
подписи - это контакт, который расходится по форуму вместе с каждой копией
сообщения. Ученику ник остаётся: он там и есть его имя.
"""

from __future__ import annotations

from backend.api.chat import MENTOR_NAME, _who
from core.models import Student

ADMIN = 555


def test_mentor_is_signed_by_the_school(monkeypatch):
    """Наставник без имени карточки подписан школой, а не ником."""
    monkeypatch.setenv("ADMIN_TG_ID", str(ADMIN))
    who = _who(Student(id=1, tg_id=ADMIN, username="kaktotakxm"))
    assert who["name"] == MENTOR_NAME
    assert who["mentor"] is True


def test_mentor_keeps_the_name_he_chose(monkeypatch):
    """Имя карточки старше умолчания: наставник вправе подписаться сам."""
    monkeypatch.setenv("ADMIN_TG_ID", str(ADMIN))
    who = _who(Student(id=1, tg_id=ADMIN, username="kaktotakxm", card_name="Артём"))
    assert who["name"] == "Артём"


def test_student_keeps_his_nick(monkeypatch):
    """У ученика ник и есть имя - подменять его нечем и незачем."""
    monkeypatch.setenv("ADMIN_TG_ID", str(ADMIN))
    who = _who(Student(id=2, tg_id=42, username="trader"))
    assert who["name"] == "trader"
    assert who["mentor"] is False


def test_without_admin_in_settings_nobody_is_mentor(monkeypatch):
    """Наставник не задан - короны нет ни у кого, и подпись обычная."""
    monkeypatch.delenv("ADMIN_TG_ID", raising=False)
    who = _who(Student(id=1, tg_id=ADMIN, username="kaktotakxm"))
    assert who["name"] == "kaktotakxm"
    assert who["mentor"] is False
