"""Включить (или выключить) процесс рыночных данных на столе.

Разделение состоит из двух согласованных правок, и порознь они делают хуже,
чем было: с флагом в `.env`, но без правил в туннеле терминал останется без
стакана. Поэтому обе правки здесь делаются вместе и в правильном порядке -
сначала туннель, потом флаг.

    python enable_market.py        # включить
    python enable_market.py --off  # вернуть как было

Скрипт ничего не перезапускает: окна сервера закрывает и открывает человек.
Перед правкой рядом с конфигом туннеля кладётся копия `*.bak` - вернуть
руками можно всегда.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from core.market_split import (
    MARKET_PORT,
    env_off,
    env_on,
    has_market,
    hostname_of,
    prefer_ipv4,
    with_market,
    without_market,
)

ROOT = Path(__file__).resolve().parent
ENV = ROOT / ".env"
LOCAL_CFG = ROOT / "cloudflared-config.yml"


def tunnel_config() -> Path | None:
    """Тот же конфиг, что берёт start.bat: локальный, иначе пользовательский."""
    if LOCAL_CFG.exists():
        return LOCAL_CFG
    home = Path(os.environ.get("USERPROFILE") or Path.home())
    user_cfg = home / ".cloudflared" / "config.yml"
    return user_cfg if user_cfg.exists() else None


def cloudflared() -> str | None:
    """Где взять cloudflared для проверки конфига. Нет - проверку пропустим."""
    local = ROOT / "cloudflared.exe"
    if local.exists():
        return str(local)
    return shutil.which("cloudflared")


def check(config: Path) -> tuple[bool, str]:
    """Спросить сам cloudflared, годится ли конфиг."""
    binary = cloudflared()
    if binary is None:
        return True, "cloudflared не найден - проверку пропускаю"
    try:
        done = subprocess.run(
            [binary, "tunnel", "ingress", "validate", "--config", str(config)],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001 - проверка не повод падать
        return True, f"проверить не удалось ({exc})"
    out = (done.stdout + done.stderr).strip().splitlines()
    return done.returncode == 0, out[-1] if out else ""


def main(argv: list[str]) -> int:
    off = "--off" in argv
    config = tunnel_config()
    if config is None:
        print("Конфиг туннеля не найден: ни cloudflared-config.yml рядом со")
        print(r"скриптом, ни %USERPROFILE%\.cloudflared\config.yml.")
        print("Запусти сначала start.bat - он соберёт конфиг сам.")
        return 1
    if not ENV.exists():
        print("Нет .env - нечего включать.")
        return 1

    text = config.read_text(encoding="utf-8")
    env = ENV.read_text(encoding="utf-8")

    if off:
        config.write_text(without_market(text), encoding="utf-8")
        ENV.write_text(env_off(env), encoding="utf-8")
        print("Разделение выключено: правила пути сняты, строка из .env убрана.")
        print("Закрой окна сервера и запусти start.bat - вернётся прежний порядок.")
        return 0

    # Заодно чиним имя в чужих правилах: `localhost` на Windows резолвится и
    # в ::1, а сервер слушает только IPv4 - запрос тогда падает, будто сервер
    # лежит. Живой лог стола 17 сентября: dial tcp [::1]:8000 ... refused.
    fixed = prefer_ipv4(text)
    if fixed != text and not has_market(text):
        print("В конфиге localhost заменён на 127.0.0.1 - иначе запрос может")
        print("уйти на ::1, куда сервер не слушает.")
        text = fixed

    # Что делать человеку потом, зависит от того, что мы тут поменяли:
    # впервые включили - перезапускать сервер целиком; поправили только
    # правила - хватит туннеля; не тронули ничего - ничего и не надо.
    was_on = has_market(text)
    touched_config = False
    if was_on:
        print(f"Правила пути на порт {MARKET_PORT} в конфиге уже есть.")
        if fixed != text:
            backup = config.with_suffix(config.suffix + ".bak")
            shutil.copy2(config, backup)
            config.write_text(fixed, encoding="utf-8")
            touched_config = True
            print("В конфиге localhost заменён на 127.0.0.1 (копия - "
                  f"{backup.name}).")
    else:
        host = hostname_of(text)
        if not host:
            print("В конфиге туннеля нет ни одного hostname - править нечего.")
            return 1
        backup = config.with_suffix(config.suffix + ".bak")
        shutil.copy2(config, backup)
        config.write_text(with_market(text, host), encoding="utf-8")
        ok, said = check(config)
        if not ok:
            shutil.copy2(backup, config)
            print("Конфиг не прошёл проверку cloudflared, вернул как было:")
            print(f"  {said}")
            return 1
        print(f"Конфиг туннеля: правила пути добавлены, копия - {backup.name}")
        touched_config = True
        if said:
            print(f"  {said}")

    env_was_on = env_on(env) == env
    ENV.write_text(env_on(env), encoding="utf-8")
    if not env_was_on:
        print("В .env добавлена строка NMNH_MARKET=1")
    print()

    if not was_on or not env_was_on:
        # Первое включение: сервер должен перечитать .env, а туннель - правила.
        print("Дальше - руками:")
        print("  1. Закрой окна MENTOR API, MENTOR Watcher, MENTOR Bot и окно туннеля.")
        print("  2. Запусти start.bat - поднимется ещё одно окно, MENTOR Market.")
        print("  3. Открой терминал и проверь стакан: он идёт с порта 8002.")
        print()
        print("Вернуть как было: python enable_market.py --off и снова start.bat")
        return 0

    if touched_config:
        # Менялся только конфиг туннеля: окна сервера трогать незачем.
        print("Разделение уже включено, поменялись только правила туннеля.")
        print("Перезапусти одно окно - то, где идёт туннель:")
        print("  1. Ctrl+C в окне туннеля (там, где шёл start.bat).")
        print("  2. В нём же:")
        print(f'     cloudflared tunnel --config "{config}" run nmnh-api')
        print()
        print("Окна API, Watcher и Market продолжают работать - их не трогай.")
        return 0

    print("Всё уже настроено, менять нечего.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
