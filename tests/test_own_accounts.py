"""Счета, подключённые без партнёрки: их не ищут в партнёрском отчёте."""

from __future__ import annotations

from core.own_accounts import is_own_account


def test_default_accounts_are_known(monkeypatch):
    monkeypatch.delenv("OWN_ACCOUNT_UIDS", raising=False)
    assert is_own_account("9100443713") is True
    assert is_own_account("6067083524") is True


def test_prefix_from_the_exchange_app_does_not_matter(monkeypatch):
    """В базе UID осел как PO6067083524 - это тот же счёт."""
    monkeypatch.delenv("OWN_ACCOUNT_UIDS", raising=False)
    assert is_own_account("PO6067083524") is True


def test_referral_is_not_an_own_account(monkeypatch):
    monkeypatch.delenv("OWN_ACCOUNT_UIDS", raising=False)
    assert is_own_account("6613031308") is False
    assert is_own_account(None) is False
    assert is_own_account("") is False


def test_setting_replaces_the_list(monkeypatch):
    monkeypatch.setenv("OWN_ACCOUNT_UIDS", "111222333, PO444555666")
    assert is_own_account("444555666") is True
    assert is_own_account("9100443713") is False


def test_empty_setting_means_no_own_accounts(monkeypatch):
    monkeypatch.setenv("OWN_ACCOUNT_UIDS", "")
    assert is_own_account("9100443713") is False
