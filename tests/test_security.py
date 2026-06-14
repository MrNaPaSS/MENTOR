"""Тесты JWT (HS256)."""

import time

import pytest

from backend.security import (
    encode_token,
    decode_token,
    create_access_token,
    create_refresh_token,
    TokenError,
)

SECRET = "unit-secret"


def test_roundtrip():
    token = encode_token({"sub": "1", "exp": int(time.time()) + 60}, SECRET)
    payload = decode_token(token, SECRET)
    assert payload["sub"] == "1"


def test_bad_signature():
    token = encode_token({"sub": "1"}, SECRET)
    with pytest.raises(TokenError):
        decode_token(token, "other-secret")


def test_malformed_token():
    with pytest.raises(TokenError):
        decode_token("not-a-jwt", SECRET)


def test_expired_token():
    token = encode_token({"sub": "1", "exp": int(time.time()) - 5}, SECRET)
    with pytest.raises(TokenError):
        decode_token(token, SECRET)


def test_access_and_refresh_types():
    a = decode_token(create_access_token("7", "student", SECRET, 60), SECRET)
    r = decode_token(create_refresh_token("7", SECRET, 60), SECRET)
    assert a["type"] == "access" and a["role"] == "student"
    assert r["type"] == "refresh"
