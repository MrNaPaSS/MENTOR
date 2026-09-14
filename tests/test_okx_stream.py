"""Приватный поток OKX: на что подписываемся и чем подписываем запрос.

Проверок здесь немного, и каждая закрывает то, что уже стоило нам живого
прогона: подписка на канал, которого по этому адресу нет, отвергается биржей
целиком, а демо-счёт живёт на своём адресе и с боевого не виден.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

from core.okx.stream import CHANNELS, WS_PRIVATE, WS_PRIVATE_DEMO, login_sign


def test_algo_channel_is_not_asked_from_the_private_address():
    """Условных заявок отсюда не просим: канал живёт на деловом адресе.

    Биржа отвечает «wrong URL or channel: orders-algo, instType: SWAP doesn't
    exist» и отказ пишется в журнал как сбой входа - проверено живым счётом
    14 сентября.
    """
    assert "orders-algo" not in CHANNELS
    # Позиции и заявки - то, на чём держится сопровождение.
    assert set(CHANNELS) == {"positions", "orders"}


def test_demo_account_lives_at_its_own_address():
    """Демо-счёт с боевого адреса не виден: биржа пускает, но данных не даёт."""
    assert WS_PRIVATE != WS_PRIVATE_DEMO
    assert "wspap" in WS_PRIVATE_DEMO


def test_login_is_signed_by_time_and_the_fixed_path():
    """Подпись входа: время, метод и постоянный путь. Тела в запросе нет."""
    stamp = "1700000000"
    expected = base64.b64encode(
        hmac.new(b"secret", f"{stamp}GET/users/self/verify".encode(), hashlib.sha256).digest()
    ).decode()
    assert login_sign("secret", stamp) == expected
