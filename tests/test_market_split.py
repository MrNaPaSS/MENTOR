"""Включение процесса рыночных данных: две правки, которые нельзя делать порознь.

С флагом в `.env`, но без правил в туннеле терминал остаётся без стакана: сайт
его уже не отдаёт, а туннель ещё не знает, куда идти. Поэтому обе правки
делает один скрипт, и здесь проверяется его чистая часть - на тексте, а не на
живом столе.
"""

from __future__ import annotations

import pytest

from core.market_split import (
    MARKET_PORT,
    env_off,
    env_on,
    has_market,
    hostname_of,
    with_market,
    without_market,
)

PLAIN = """tunnel: 0f1e
credentials-file: C:/Users/x/.cloudflared/0f1e.json
ingress:
  - hostname: api.nmnh.trade
    service: http://127.0.0.1:8000
  - service: http_status:404
"""


def test_rules_go_first():
    """Правила пути встают перед общим правилом хоста.

    cloudflared берёт первое подходящее: после общего правила наши не
    сработали бы никогда, и стакан продолжал бы ходить на сайт.
    """
    out = with_market(PLAIN)
    lines = [l.strip() for l in out.splitlines()]
    first_path = next(i for i, l in enumerate(lines) if l.startswith("path:"))
    catch_all = next(
        i for i, l in enumerate(lines) if l == f"service: http://127.0.0.1:8000"
    )
    assert first_path < catch_all


def test_both_paths_go_to_the_market_process():
    out = with_market(PLAIN)
    assert out.count(f"http://127.0.0.1:{MARKET_PORT}") == 2
    assert "path: ^/ws/scalping" in out
    assert "path: ^/api/scalping" in out
    # Имя берётся из самого конфига, а не зашито.
    assert out.count("hostname: api.nmnh.trade") == 3


def test_turning_it_on_twice_changes_nothing():
    once = with_market(PLAIN)
    assert with_market(once) == once
    assert has_market(once) and not has_market(PLAIN)


def test_off_returns_the_file_as_it_was():
    """Выключение возвращает ровно исходный текст: комментарии и порядок целы."""
    assert without_market(with_market(PLAIN)) == PLAIN


def test_comments_and_order_survive():
    text = PLAIN.replace("ingress:", "# наши правила\ningress:")
    assert "# наши правила" in with_market(text)


def test_a_config_without_hostname_is_refused():
    """Без имени хоста правило писать не на что - лучше сказать, чем угадать."""
    with pytest.raises(ValueError):
        with_market("ingress:\n  - service: http_status:404\n")


def test_a_config_without_ingress_is_refused():
    with pytest.raises(ValueError):
        with_market("tunnel: 0f1e\n")


def test_hostname_is_taken_from_the_first_rule():
    assert hostname_of(PLAIN) == "api.nmnh.trade"
    assert hostname_of("ingress:\n") == ""


def test_env_line_is_added_once():
    assert env_on("A=1\n") == "A=1\nNMNH_MARKET=1\n"
    assert env_on(env_on("A=1\n")) == "A=1\nNMNH_MARKET=1\n"
    # Файл без перевода строки в конце не склеивается со строкой флага.
    assert env_on("A=1") == "A=1\nNMNH_MARKET=1\n"


def test_a_commented_out_line_is_raised():
    """Строку, выключенную руками, поднимаем, а не пишем вторую такую же."""
    assert env_on("A=1\n# NMNH_MARKET=1\n") == "A=1\nNMNH_MARKET=1\n"
    assert env_on("NMNH_MARKET=0\n") == "NMNH_MARKET=1\n"


def test_env_off_removes_the_line_entirely():
    """Выключаем удалением строки: `NMNH_MARKET=0` читалось бы как включённое."""
    assert env_off("A=1\nNMNH_MARKET=1\nB=2\n") == "A=1\nB=2\n"
    assert env_off("A=1\n") == "A=1\n"


# ── сам скрипт: обе правки разом ────────────────────────────────────────────


def test_the_script_edits_both_files_and_keeps_a_copy(tmp_path, monkeypatch):
    import enable_market

    config = tmp_path / "cloudflared-config.yml"
    config.write_text(PLAIN, encoding="utf-8")
    env = tmp_path / ".env"
    env.write_text("DATABASE_URL=postgresql://x\n", encoding="utf-8")
    monkeypatch.setattr(enable_market, "LOCAL_CFG", config)
    monkeypatch.setattr(enable_market, "ENV", env)

    assert enable_market.main([]) == 0

    assert f"127.0.0.1:{MARKET_PORT}" in config.read_text(encoding="utf-8")
    assert "NMNH_MARKET=1" in env.read_text(encoding="utf-8")
    # Копия конфига - чтобы вернуть руками можно было всегда.
    assert (tmp_path / "cloudflared-config.yml.bak").read_text(encoding="utf-8") == PLAIN


def test_the_script_puts_everything_back(tmp_path, monkeypatch):
    import enable_market

    config = tmp_path / "cloudflared-config.yml"
    config.write_text(PLAIN, encoding="utf-8")
    env = tmp_path / ".env"
    env.write_text("DATABASE_URL=postgresql://x\n", encoding="utf-8")
    monkeypatch.setattr(enable_market, "LOCAL_CFG", config)
    monkeypatch.setattr(enable_market, "ENV", env)

    enable_market.main([])
    assert enable_market.main(["--off"]) == 0

    assert config.read_text(encoding="utf-8") == PLAIN
    assert env.read_text(encoding="utf-8") == "DATABASE_URL=postgresql://x\n"


def test_without_a_config_the_script_says_so_and_changes_nothing(tmp_path, monkeypatch):
    """Стол ещё не настроен - лучше отказать, чем включить половину."""
    import enable_market

    env = tmp_path / ".env"
    env.write_text("DATABASE_URL=postgresql://x\n", encoding="utf-8")
    monkeypatch.setattr(enable_market, "LOCAL_CFG", tmp_path / "нет.yml")
    monkeypatch.setattr(enable_market, "ENV", env)
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "пусто"))

    assert enable_market.main([]) == 1
    assert "NMNH_MARKET" not in env.read_text(encoding="utf-8")


def test_the_user_config_is_found_too(tmp_path, monkeypatch):
    """На столе конфиг может лежать не рядом со скриптом, а в профиле."""
    import enable_market

    home = tmp_path / "profile"
    (home / ".cloudflared").mkdir(parents=True)
    config = home / ".cloudflared" / "config.yml"
    config.write_text(PLAIN, encoding="utf-8")
    monkeypatch.setattr(enable_market, "LOCAL_CFG", tmp_path / "нет.yml")
    monkeypatch.setenv("USERPROFILE", str(home))

    assert enable_market.tunnel_config() == config


def test_a_ready_config_is_left_alone(tmp_path, monkeypatch):
    """Правила уже стоят - конфиг не трогаем и копию не плодим."""
    import enable_market

    config = tmp_path / "cloudflared-config.yml"
    config.write_text(with_market(PLAIN), encoding="utf-8")
    env = tmp_path / ".env"
    env.write_text("DATABASE_URL=postgresql://x\n", encoding="utf-8")
    monkeypatch.setattr(enable_market, "LOCAL_CFG", config)
    monkeypatch.setattr(enable_market, "ENV", env)

    assert enable_market.main([]) == 0
    assert not (tmp_path / "cloudflared-config.yml.bak").exists()
    assert "NMNH_MARKET=1" in env.read_text(encoding="utf-8")


# ── localhost против ::1 ────────────────────────────────────────────────────


def test_localhost_becomes_an_address():
    """`localhost` на Windows резолвится и в ::1, куда сервер не слушает.

    Живой лог стола 17 сентября: `dial tcp [::1]:8000 ... refused` - снаружи
    это выглядит как «сервер лежит», хотя он жив.
    """
    from core.market_split import prefer_ipv4

    out = prefer_ipv4("    service: http://localhost:8000\n")
    assert out == "    service: http://127.0.0.1:8000\n"


def test_only_service_lines_are_touched():
    """Имя хоста и комментарии не трогаем: localhost там значит другое."""
    from core.market_split import prefer_ipv4

    text = "# сайт на localhost\n  - hostname: localhost.nmnh.trade\n    service: http://localhost:8000\n"
    out = prefer_ipv4(text)
    assert "# сайт на localhost" in out
    assert "hostname: localhost.nmnh.trade" in out
    assert "service: http://127.0.0.1:8000" in out


def test_the_script_fixes_localhost_while_turning_it_on(tmp_path, monkeypatch):
    import enable_market

    config = tmp_path / "cloudflared-config.yml"
    config.write_text(PLAIN.replace("127.0.0.1:8000", "localhost:8000"), encoding="utf-8")
    env = tmp_path / ".env"
    env.write_text("DATABASE_URL=postgresql://x\n", encoding="utf-8")
    monkeypatch.setattr(enable_market, "LOCAL_CFG", config)
    monkeypatch.setattr(enable_market, "ENV", env)

    assert enable_market.main([]) == 0

    out = config.read_text(encoding="utf-8")
    assert "localhost" not in out
    assert "service: http://127.0.0.1:8000" in out
    assert f"127.0.0.1:{MARKET_PORT}" in out
