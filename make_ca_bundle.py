"""Сборка набора доверенных корней для Python на этой машине.

Зачем. На сервере HTTPS-соединения перехватываются - антивирусом или прокси, -
и Telegram отдаёт сертификат, подписанный не публичным центром, а корнем
перехватчика. Windows этому корню доверяет, а Python при проверке до него не
добирается и отказывает: «self-signed certificate in certificate chain». Ни
бэкенд, ни бот в Telegram при этом не попадают вовсе.

Проверку не отключаем - это сняло бы защиту со всех соединений разом, включая
запросы к бирже с торговыми ключами. Вместо этого собираем набор, в котором
есть и публичные центры, и корни из хранилища Windows, - и указываем его Python
переменной ``SSL_CERT_FILE``.

Запуск: ``python make_ca_bundle.py``

Скрипт сам проверит связь с Telegram собранным набором и скажет, помогло ли.
"""

from __future__ import annotations

import base64
import os
import ssl
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "ca-bundle.pem"

# Хранилища Windows: корневые центры и промежуточные. Промежуточные нужны не
# всегда, но перехватчики нередко кладут свой сертификат именно туда.
STORES = ("ROOT", "CA")

PROBE = "https://api.telegram.org"


def pem(der: bytes) -> str:
    """Сертификат в текстовом виде: строками по 64 знака, как принято."""
    body = base64.b64encode(der).decode("ascii")
    lines = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN CERTIFICATE-----\n{lines}\n-----END CERTIFICATE-----\n"


def public_roots() -> str:
    """Публичные центры из certifi. Нет его - обойдёмся хранилищем Windows."""
    try:
        import certifi
    except ImportError:
        print("  certifi не установлен - беру только хранилище Windows")
        return ""

    where = Path(certifi.where())
    if not where.exists():
        # Так бывает: certifi распаковывает набор во временную папку, и она
        # переживает не всякую перезагрузку.
        print(f"  набор certifi не найден по пути {where} - пропускаю")
        return ""

    print(f"  certifi: {where}")
    return where.read_text(encoding="ascii", errors="ignore")


def windows_roots() -> tuple[str, int]:
    """Корни из хранилища Windows - там и лежит корень перехватчика."""
    if not hasattr(ssl, "enum_certificates"):
        print("  перечисление хранилища доступно только на Windows")
        return "", 0

    out = []
    for store in STORES:
        try:
            found = ssl.enum_certificates(store)
        except Exception as exc:  # noqa: BLE001 - хранилища может не быть
            print(f"  хранилище {store} не читается: {exc}")
            continue
        taken = 0
        for der, encoding, _trust in found:
            if encoding != "x509_asn":
                continue
            out.append(pem(der))
            taken += 1
        print(f"  хранилище {store}: {taken}")
    return "".join(out), len(out)


def probe(bundle: Path) -> bool:
    """Достучаться до Telegram собранным набором. Это и есть ответ."""
    context = ssl.create_default_context(cafile=str(bundle))
    try:
        with urllib.request.urlopen(PROBE, context=context, timeout=15) as res:
            res.read(1)
        return True
    except Exception as exc:  # noqa: BLE001 - нам важна любая неудача
        print(f"\nСвязь с Telegram не установилась: {exc}")
        return False


def main() -> int:
    print("Собираю набор доверенных корней...")
    text = public_roots()
    windows, count = windows_roots()
    text += windows

    if not text.strip():
        print("\nНабор пуст - собирать нечего.")
        return 1

    OUT.write_text(text, encoding="ascii", errors="ignore")
    print(f"\nНабор записан: {OUT} (корней из Windows: {count})")

    if not probe(OUT):
        print(
            "\nЗначит корня перехватчика нет и в хранилище Windows.\n"
            "Остаётся исключить api.telegram.org из проверки защищённых\n"
            "соединений в антивирусе - такая настройка есть у всех."
        )
        return 2

    print("\nСвязь с Telegram есть. Допишите в .env строку:")
    print(f"\n    SSL_CERT_FILE={OUT}\n")
    print("и перезапустите start.bat.")
    return 0


if __name__ == "__main__":
    # Вывод в консоль Windows: без этого кириллица в путях ломает печать.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    os.environ.pop("SSL_CERT_FILE", None)  # проверяем набор, а не прежнюю настройку
    raise SystemExit(main())
