"""FastAPI-приложение NMNH (фабрика + точка входа).

Запуск: ``uvicorn backend.main:app`` или ``python -m backend.main``.
"""

from __future__ import annotations

import asyncio

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.chat import ChatHub
from core.db import init_engine, create_all, SessionLocal
from core import repo
from core.weex import get_weex_client
from backend.config import BackendConfig
from backend.trading.watcher import PositionWatcher
from backend.api import shots
from backend.api import trading as trading_api
from backend.api import auth, market, market_data, market_extra, signals, stats, students, profile, admin_affiliate, institutional, broadcast, pnl, trades, journal, trading, coins, shop
from backend.api import chat as chat_api
from backend.api import scalping as scalping_api
from backend.api import trading_move
from backend.ws import ConnectionManager
from backend.ws import routes as ws_routes
from backend.price_collector import PriceCollector
from backend.balance_collector import BalanceCollector
from backend.scalping.collector import ScalpingCollector
from backend.scalping.density_alerts import DensityWatcher, run_watcher as run_density_watcher
from backend.ws.scalping_hub import ScalpingHub
from backend.notify import get_notifier
from backend.ratelimit import RateLimiter, AuthRateLimitMiddleware


def create_app(
    config: BackendConfig | None = None, weex=None, notifier=None, price_interval: float = 5.0
) -> FastAPI:
    config = config or BackendConfig.from_env()
    weex = weex or get_weex_client(config.weex_use_mock)
    notifier = notifier or get_notifier(config.bot_token)

    init_engine()
    create_all()
    with SessionLocal() as session:
        repo.seed_settings(session)

    manager = ConnectionManager()
    collector = PriceCollector(weex, manager, interval=price_interval)
    balance_collector = BalanceCollector(weex)

    # Скальпинг держит постоянное соединение с биржей и заметный поток данных,
    # поэтому включается флагом, а не сам собой.
    scalping = ScalpingCollector(top_n=config.scalping_top_n) if config.scalping_enabled else None
    scalping_hub = ScalpingHub(scalping) if scalping else None

    # Оповещения о плотности берут книгу у сборщика: без скальпинга стакана
    # нет, и включать их отдельно нечего
    density = None
    if scalping and config.density_alerts_enabled and config.bot_token and config.density_chat_id:
        density = DensityWatcher(
            state=scalping.state,
            symbols=config.density_symbols,
            min_notional=config.density_min_notional,
        )

    # Ведение позиций: стоп в безубыток после первой цели переносится сервером,
    # иначе закрытая вкладка означала бы сделку без сопровождения.
    watcher = PositionWatcher(SessionLocal, trading_api._get_session)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        collector.start()
        balance_collector.start()
        if scalping:
            scalping.start()
        density_task = None
        if density:
            async def _post(text: str) -> None:
                await notifier.send_message(
                    config.density_chat_id,
                    text,
                    message_thread_id=config.density_topic_id or None,
                    parse_mode="HTML",
                )

            density_task = asyncio.create_task(run_density_watcher(density, _post))
        watcher.start()
        try:
            yield
        finally:
            if density_task:
                density_task.cancel()
                try:
                    await density_task
                except asyncio.CancelledError:
                    pass
            await watcher.stop()
            await trading_api.close_session()
            if scalping_hub:
                await scalping_hub.stop()
            if scalping:
                await scalping.stop()
            await collector.stop()
            await balance_collector.stop()
            await weex.close()
            await notifier.close()

    app = FastAPI(title="NMNH Platform API", version="0.1.0", lifespan=lifespan)
    app.state.config = config
    app.state.weex = weex
    app.state.notifier = notifier
    app.state.ws_manager = manager
    # Комната общего чата: присутствие и рассылка живут в памяти процесса,
    # сами сообщения - в базе. Перезапуск сервера теряет только список
    # присутствующих, и он соберётся заново с первым же подключением.
    app.state.chat_hub = ChatHub()
    app.state.price_collector = collector
    app.state.scalping = scalping
    app.state.scalping_hub = scalping_hub

    # Rate limiting на /api/auth/* (ТЗ §4.3, A-08).
    limiter = RateLimiter(config.rate_limit_max, config.rate_limit_window)
    app.state.rate_limiter = limiter
    # Выдача одноразового пароля считается по ученику, а не по адресу: за
    # паролями ходит бот, и адрес у всех его запросов один.
    app.state.tg_code_limiter = RateLimiter(config.tg_code_max, config.tg_code_window)
    # Живые пароли: в базе только хеш, а повторный запрос обязан отдать тот же
    # пароль. Держим его здесь на время жизни - память переживает пять минут,
    # дамп базы живёт годами.
    app.state.tg_code_cache = {}
    # Проверка одноразового пароля - отдельным, узким счётом: он проверяется
    # сам по себе, и перебор бьёт именно сюда.
    app.add_middleware(
        AuthRateLimitMiddleware,
        limiter=limiter,
        tight={
            "/api/auth/tg/verify": RateLimiter(
                config.tg_verify_max, config.tg_verify_window
            )
        },
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.allowed_origins),  # из ALLOWED_ORIGINS (прод — домен фронта)
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    app.include_router(auth.router)
    app.include_router(market.router)
    app.include_router(market_data.router)
    app.include_router(market_extra.router)
    app.include_router(signals.router)
    app.include_router(stats.router)
    app.include_router(students.router)
    app.include_router(profile.router)
    app.include_router(shots.api_router)
    app.include_router(admin_affiliate.router)
    app.include_router(institutional.router)
    app.include_router(broadcast.router)
    app.include_router(pnl.router)
    app.include_router(trades.router)
    app.include_router(journal.router)
    app.include_router(trading.router)
    app.include_router(trading_move.router)
    app.include_router(coins.router)
    app.include_router(shop.router)
    app.include_router(shop.admin_router)
    app.include_router(chat_api.router)
    app.include_router(scalping_api.router)
    app.include_router(ws_routes.router)
    # Короткий путь снимка - последним: он живёт в корне и ловит одиночный
    # сегмент, поэтому пускать его вперёд остальных маршрутов нельзя.
    app.include_router(shots.router)

    # Отдача загруженных файлов (картинки товаров и т.п.). Фронт подставляет API_URL
    # к путям /uploads/..., поэтому файлы грузятся с бэкенда даже при сплит-деплое.
    uploads_dir = Path(__file__).parent.parent / "webapp" / "public" / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

    # PnL-скриншоты грузятся на бэкенд (этот сервер), поэтому раздаём их отсюда же.
    # Фронт на Render берёт их по ${API_URL}/pln/... (иначе новые файлы видны только локально).
    pln_dir = Path(__file__).parent.parent / "webapp" / "public" / "pln"
    pln_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/pln", StaticFiles(directory=str(pln_dir)), name="pln")

    @app.get("/api/health", tags=["health"])
    async def health():
        return {
            "status": "ok",
            "weex_mock": config.weex_use_mock,
            "ws_clients": manager.count,
            "scalping": bool(scalping),
        }

    return app


app = create_app()


def main() -> None:  # pragma: no cover
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":  # pragma: no cover
    main()
