"""Приборная панель бирж: задержки, отказы, потоки, обходы.

Разбор поломки начинался с просьбы прислать лог и шёл после того, как она
стоила денег. Здесь те же события считаются числами.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.trading import health
from core.db import Base
from core.models import SettingRow  # noqa: F401 - регистрация таблиц схемы


@pytest.fixture(autouse=True)
def _clean():
    health.clear()
    yield
    health.clear()


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    made = sessionmaker(bind=engine, expire_on_commit=False)()
    yield made
    made.close()


def test_the_panel_counts_calls_and_refusals():
    health.note_call("okx", 120.0, True, "positions")
    health.note_call("okx", 320.0, True, "positions")
    health.note_call("okx", 90.0, False, "place_tp_sl", "51169")

    venue = health.snapshot()["venues"][0]
    assert venue["exchange"] == "okx"
    assert venue["calls"] == 3 and venue["errors"] == 1
    assert venue["error_share"] == pytest.approx(0.333, abs=0.001)
    assert venue["ms_median"] == 120.0
    assert venue["codes"][0] == {"code": "51169", "times": 1}
    assert "51169" in venue["last_error"]


def test_old_calls_leave_the_window():
    """Панель про «сейчас»: вчерашние отказы не должны красить её сегодня."""
    health.note_call("binance", 100.0, False, "place_tp_sl", "-1102")
    shot = health.snapshot(window=1.0, now=health.time.time() + 600)
    assert shot["venues"][0]["calls"] == 0
    assert shot["venues"][0]["errors"] == 0


def test_streams_are_counted_up_and_down():
    health.note_stream("bingx", up=True)
    assert health.snapshot()["venues"][0]["streams"] == 1

    health.note_stream("bingx", up=False)
    venue = health.snapshot()["venues"][0]
    assert venue["streams"] == 0 and venue["stream_drops_total"] == 1


def test_drops_are_counted_inside_the_window():
    """Панель обещает пять минут: вчерашние обрывы в это число не входят.

    Общий счёт с запуска остаётся рядом - по нему видно, часто ли рвётся
    вообще, но пугать свежими он не должен.
    """
    health.note_stream("binance", up=False)
    health.note_call("binance", 0.0, False, "поток", "обрыв 1006")

    venue = health.snapshot()["venues"][0]
    assert venue["stream_drops"] == 1 and venue["stream_drops_total"] == 1

    old = health.snapshot(window=1.0, now=health.time.time() + 600)["venues"][0]
    assert old["stream_drops"] == 0 and old["stream_drops_total"] == 1


def test_the_pass_of_the_watcher_is_timed():
    for seconds in (1.0, 2.0, 9.0):
        health.note_pass(seconds)
    watcher = health.snapshot()["watcher"]
    assert watcher["passes"] == 3
    assert watcher["seconds_median"] == 2.0
    assert watcher["seconds_worst"] == 9.0


def test_two_processes_make_one_panel():
    """Терминал и сопровождение видят одну биржу с разных сторон."""
    api = {
        "window": 300.0,
        "role": "api",
        "venues": [
            {"exchange": "okx", "calls": 10, "errors": 0, "ms_median": 100, "ms_worst": 200,
             "streams": 1, "stream_drops": 0, "stream_minutes": 5.0}
        ],
        "watcher": {},
    }
    watcher = {
        "window": 300.0,
        "role": "watcher",
        "venues": [
            {"exchange": "okx", "calls": 30, "errors": 3, "ms_median": 150, "ms_worst": 900,
             "streams": 1, "stream_drops": 2, "stream_minutes": 7.0,
             "last_error": "place_tp_sl: -1102", "last_error_ago": 12}
        ],
        "watcher": {"passes": 60, "seconds_median": 1.2, "seconds_worst": 4.0},
    }

    both = health.merge([api, watcher])
    venue = both["venues"][0]
    assert venue["calls"] == 40 and venue["errors"] == 3
    # Задержку берём худшую из процессов: беду не усредняем.
    assert venue["ms_worst"] == 900 and venue["ms_median"] == 150
    assert venue["streams"] == 2 and venue["stream_drops"] == 2
    assert venue["last_error"] == "place_tp_sl: -1102"
    assert both["watcher"]["passes"] == 60


def test_the_snapshot_travels_through_the_database(session):
    health.note_call("mexc", 200.0, True, "positions")
    health.publish(session, "watcher")

    shots = health.published(session)
    assert len(shots) == 1 and shots[0]["role"] == "watcher"
    assert shots[0]["venues"][0]["exchange"] == "mexc"


def test_a_stale_snapshot_is_not_shown(session):
    """Процесс мог умереть час назад: его числа больше ничего не значат."""
    import time as clock

    health.note_call("weex", 100.0, True, "positions")
    health.publish(session, "api", now=clock.time() - 3600)
    assert health.published(session) == []


def test_a_broken_stream_does_not_spoil_the_latency():
    """Обрыв потока - не запрос: в задержках и отказах бирже его нет.

    Панель писала «ответ обычно 43 секунды» и «отказов 57%» на бирже, которая
    отвечала за треть секунды: числом там было время жизни оборванного
    соединения, а отказом сам обрыв. Разбирать по такой панели нечего.
    """
    for _ in range(3):
        health.note_call("binance", 300.0, True, "depth")
    for _ in range(4):
        health.note_call("binance", 0.0, False, health.STREAM, "обрыв 1006")

    venue = health.snapshot()["venues"][0]
    assert venue["calls"] == 3 and venue["errors"] == 0
    assert venue["error_share"] == 0.0
    assert venue["ms_median"] == 300.0 and venue["ms_worst"] == 300.0
    # Обрывы не исчезли - у них своя строка, и по ней видно беду.
    assert venue["stream_drops"] == 4
    assert "1006" in venue["last_error"]


def test_an_answer_from_memory_is_not_a_visit_to_the_exchange():
    """Мгновенный ответ клиента из памяти занижал бы задержку биржи вдвое."""
    health.note_call("okx", 0.0, True, "symbols")
    health.note_call("okx", 400.0, True, "positions")

    venue = health.snapshot()["venues"][0]
    assert venue["calls"] == 2 and venue["ms_median"] == 400.0


def test_a_quick_pass_is_not_rounded_to_nothing():
    """Обход в двадцать миллисекунд - это работа, а не ноль.

    Задержки бирж считаны в миллисекундах, обход сопровождения - в секундах, и
    общая точность в десятую долю писала «обычный занимает 0 мс» о живом
    обходе.
    """
    for seconds in (0.018, 0.021, 0.024):
        health.note_pass(seconds)

    watcher = health.snapshot()["watcher"]
    assert watcher["seconds_median"] == 0.021
    assert watcher["seconds_worst"] == 0.024
