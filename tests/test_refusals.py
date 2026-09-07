"""Отказы биржи человеческими словами."""

from __future__ import annotations

import pytest

from backend.trading.refusals import explain


def test_position_limit_names_the_number_and_what_to_do():
    """Главный отказ: предел позиции на выбранном плече.

    Числа из ответа - это и есть ответ, терять их нельзя. И сказать надо не
    «превышен предел», а что именно сделать.
    """
    said = explain(
        "FAILED_PRECONDITION: If order is filled, may lead to position exceed "
        "max size 53.82 for leverage '100'. you can cancel some order or reduce "
        "leverage and try again"
    )
    assert "×100" in said
    assert "53.82" in said
    assert "плечо" in said
    # Предел считается по всем заявкам монеты сразу - об этом надо сказать,
    # иначе трейдер уменьшит сумму и получит тот же отказ.
    assert "заявки" in said


@pytest.mark.parametrize(
    "answer,words",
    [
        ("cannot set reduce only, you must cancel some order", "сокращающий"),
        ("Insufficient balance", "не хватает"),
        ("order size must match stepSize", "шагу лота"),
        ("price precision error", "шагу цены"),
        ("leverage not supported for this symbol", "плечо"),
    ],
)
def test_known_refusals_are_translated(answer, words):
    assert words in explain(answer)


def test_unknown_refusal_is_shown_as_is():
    """Выдумывать объяснение непонятому отказу хуже, чем показать оригинал."""
    said = explain("SOMETHING_NEW: try later")
    assert "SOMETHING_NEW: try later" in said


def test_empty_answer_still_says_something():
    assert explain("") == "Биржа отказала без объяснения"
