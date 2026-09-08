"""Конфигурация бэкенда из окружения."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    # Явный путь к .env относительно этого файла — работает при любом CWD
    _env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path, override=True)
except Exception:  # pragma: no cover
    pass


@dataclass(frozen=True)
class BackendConfig:
    jwt_secret: str
    access_ttl_seconds: int
    refresh_ttl_seconds: int
    weex_use_mock: bool
    code_ttl_seconds: int
    max_code_attempts: int
    expose_codes: bool  # dev: возвращать код в ответе request-code
    bot_token: str = ""  # для доставки кода в Telegram
    admin_tg_id: int = 0  # Telegram chat_id ментора для уведомлений (заказы магазина и т.д.)
    rate_limit_max: int = 10            # попыток на /api/auth/* за окно
    rate_limit_window: int = 900        # окно, сек (15 мин)
    allowed_origins: tuple = ("*",)     # CORS: домены фронта
    dev_login: bool = False             # dev: вход без кода/пароля (только не в проде)
    # Общий секрет для служебных вызовов от сервера академии (заголовок X-Service-Key).
    # Пустая строка = ручка выключена: без явно заданного ключа её открывать нельзя.
    service_api_key: str = ""
    # Вход одноразовым паролем от бота академии.
    #
    # Срок отдельный от кода по UID: там шесть цифр рядом с уже введённым
    # счётом, здесь восемь знаков, которые проверяются сами по себе.
    tg_code_ttl_seconds: int = 300
    # Выдач пароля одному ученику за окно: он жмёт кнопку, а не перебирает.
    tg_code_max: int = 3
    tg_code_window: int = 600
    # Проверок пароля с одного адреса. Узкий предел именно здесь: подходит
    # любой живой пароль любого ученика, и перебор бьёт по этой ручке.
    tg_verify_max: int = 5
    tg_verify_window: int = 60
    # Вход по одному UID, без Telegram. Выключен: Telegram стал единственным
    # способом попасть в кабинет - только через него UID биржи связывается с
    # человеком, а его ник попадает в подписи на карточках и снимках.
    #
    # Флаг, а не удаление ручек. Если у кого-то не окажется tg_id ни в записи
    # платформы, ни в боте, вернуть ему доступ к собственному счёту надо уметь
    # одной переменной, а не деплоем посреди ночи.
    uid_login_enabled: bool = False
    # Скальпинг: фоновый сбор стаканов с биржи. Выключен по умолчанию — это
    # постоянное соединение и заметный поток данных, включать осознанно.
    scalping_enabled: bool = False
    scalping_top_n: int = 50
    # Оповещения о плотности в стакане: крупные заявки в тему торгового
    # форума. Работают только вместе со скальпингом - берут его же книгу.
    density_alerts_enabled: bool = False
    density_chat_id: int = 0
    density_topic_id: int = 0
    density_min_notional: float = 5_000_000.0
    density_symbols: tuple = ("BTCUSDT",)


    @staticmethod
    def _require(key: str) -> str:
        val = os.getenv(key, "")
        if not val:
            raise RuntimeError(f"{key} не задан в .env")
        return val

    @classmethod
    def from_env(cls) -> "BackendConfig":
        origins = os.getenv("ALLOWED_ORIGINS", "*")
        use_mock = os.getenv("WEEX_USE_MOCK", "true").lower() != "false"
        dev_login_env = os.getenv("DEV_LOGIN", "").lower()
        return cls(
            jwt_secret=cls._require("JWT_SECRET"),
            access_ttl_seconds=int(os.getenv("ACCESS_TTL", str(15 * 60))),
            refresh_ttl_seconds=int(os.getenv("REFRESH_TTL", str(30 * 24 * 3600))),
            weex_use_mock=use_mock,
            code_ttl_seconds=int(os.getenv("AUTH_CODE_TTL", "300")),
            max_code_attempts=int(os.getenv("AUTH_MAX_ATTEMPTS", "5")),
            expose_codes=os.getenv("AUTH_EXPOSE_CODES", "false").lower() == "true",
            bot_token=os.getenv("BOT_TOKEN", ""),
            admin_tg_id=int(os.getenv("ADMIN_TG_ID", "0") or "0"),
            scalping_enabled=os.getenv("SCALPING_ENABLED", "false").lower() == "true",
            scalping_top_n=int(os.getenv("SCALPING_TOP_N", "50") or "50"),
            density_alerts_enabled=os.getenv("DENSITY_ALERTS_ENABLED", "false").lower() == "true",
            density_chat_id=int(os.getenv("DENSITY_CHAT_ID", "0") or "0"),
            density_topic_id=int(os.getenv("DENSITY_TOPIC_ID", "0") or "0"),
            density_min_notional=float(os.getenv("DENSITY_MIN_NOTIONAL", "5000000") or "5000000"),
            density_symbols=tuple(
                s.strip().upper()
                for s in os.getenv("DENSITY_SYMBOLS", "BTCUSDT").split(",")
                if s.strip()
            ),
            rate_limit_max=int(os.getenv("RATE_LIMIT_MAX", "10")),
            rate_limit_window=int(os.getenv("RATE_LIMIT_WINDOW", "900")),
            service_api_key=os.getenv("SERVICE_API_KEY", ""),
            tg_code_ttl_seconds=int(os.getenv("TG_CODE_TTL", "300") or "300"),
            tg_code_max=int(os.getenv("TG_CODE_MAX", "3") or "3"),
            tg_code_window=int(os.getenv("TG_CODE_WINDOW", "600") or "600"),
            tg_verify_max=int(os.getenv("TG_VERIFY_MAX", "5") or "5"),
            tg_verify_window=int(os.getenv("TG_VERIFY_WINDOW", "60") or "60"),
            uid_login_enabled=os.getenv("UID_LOGIN_ENABLED", "false").lower() == "true",
            allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            # dev-вход включён, если явно DEV_LOGIN=true, либо мы на моках WEEX (=dev),
            # и НЕ отключён явно DEV_LOGIN=false.
            dev_login=(dev_login_env == "true") or (use_mock and dev_login_env != "false"),
        )
