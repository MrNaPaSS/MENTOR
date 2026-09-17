"""Включение и выключение процесса рыночных данных на столе.

Разделение состоит из двух согласованных правок: строка в `.env` и правила
пути в конфиге туннеля. Порознь они делают хуже, чем было: с флагом, но без
правил терминал остаётся без стакана - сайт его уже не отдаёт, а туннель ещё
не знает, куда идти. Поэтому обе правки делает один скрипт
(`enable_market.py`), а здесь - их чистая часть, которую можно проверить
тестами, не трогая живой стол.

Конфиг туннеля правится текстом, а не через разбор YAML: в нём комментарии и
свой порядок строк, и переписывать его целиком ради двух правил незачем.
Вставленное помечено маркерами - по ним же оно и снимается.
"""

from __future__ import annotations

import re

# Порт процесса рыночных данных. 8000 - сайт, 8001 - сопровождение.
MARKET_PORT = 8002

# Пути, которые уходят на него: канал стакана и рыночные ручки терминала.
MARKET_PATHS = ("^/ws/scalping", "^/api/scalping")

# Маркеры вставленного куска: по ним правки снимаются обратно.
MARK_START = "  # nmnh-market: start"
MARK_END = "  # nmnh-market: end"

ENV_LINE = "NMNH_MARKET=1"


def hostname_of(config: str) -> str:
    """Имя, которым туннель отдаёт сервер. Пусто - в конфиге его нет."""
    match = re.search(r"^\s*-\s*hostname:\s*(\S+)", config, re.MULTILINE)
    return match.group(1) if match else ""


def has_market(config: str) -> bool:
    return MARK_START in config or f"127.0.0.1:{MARKET_PORT}" in config


def with_market(config: str, hostname: str = "") -> str:
    """Конфиг с правилами пути на процесс рынка.

    Правила встают сразу после `ingress:` - первыми: cloudflared берёт первое
    подходящее, и после общего правила хоста они не сработали бы никогда.
    """
    if has_market(config):
        return config
    host = hostname or hostname_of(config)
    if not host:
        raise ValueError("В конфиге туннеля нет ни одного hostname")
    lines = [MARK_START]
    for path in MARKET_PATHS:
        lines += [
            f"  - hostname: {host}",
            f"    path: {path}",
            f"    service: http://127.0.0.1:{MARKET_PORT}",
        ]
    lines.append(MARK_END)
    block = "\n".join(lines)

    def insert(match: re.Match) -> str:
        return f"{match.group(0)}\n{block}"

    out, count = re.subn(r"^ingress:\s*$", insert, config, count=1, flags=re.MULTILINE)
    if not count:
        raise ValueError("В конфиге туннеля нет раздела ingress")
    return out


def without_market(config: str) -> str:
    """Конфиг без наших правил: всё между маркерами вырезается."""
    pattern = re.compile(
        rf"{re.escape(MARK_START)}.*?{re.escape(MARK_END)}\n?",
        re.DOTALL,
    )
    return pattern.sub("", config)


def env_on(env: str) -> str:
    """`.env` с включённым разделением. Повторный вызов ничего не меняет."""
    if re.search(rf"^{ENV_LINE}$", env, re.MULTILINE):
        return env
    # Была выключенная или закомментированная строка - поднимаем её.
    out, count = re.subn(
        r"^#?\s*NMNH_MARKET=.*$", ENV_LINE, env, count=1, flags=re.MULTILINE
    )
    if count:
        return out
    tail = "" if env.endswith("\n") or not env else "\n"
    return f"{env}{tail}{ENV_LINE}\n"


def env_off(env: str) -> str:
    """`.env` без разделения: строку убираем совсем, а не правим значение."""
    return re.sub(r"^NMNH_MARKET=.*\n?", "", env, flags=re.MULTILINE)
