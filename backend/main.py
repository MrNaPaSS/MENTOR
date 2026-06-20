"""FastAPI-приложение NMNH (фабрика + точка входа).

Запуск: ``uvicorn backend.main:app`` или ``python -m backend.main``.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from core.db import init_engine, create_all, SessionLocal
from core import repo
from core.weex import get_weex_client
from backend.config import BackendConfig
from backend.api import auth, market, market_data, market_extra, signals, stats, students, profile, admin_affiliate, institutional, broadcast, pnl, trades, coins, shop
from backend.ws import ConnectionManager
from backend.ws import routes as ws_routes
from backend.price_collector import PriceCollector
from backend.balance_collector import BalanceCollector
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

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        collector.start()
        balance_collector.start()
        try:
            yield
        finally:
            await collector.stop()
            await balance_collector.stop()
            await weex.close()
            await notifier.close()

    app = FastAPI(title="NMNH Platform API", version="0.1.0", lifespan=lifespan)
    app.state.config = config
    app.state.weex = weex
    app.state.notifier = notifier
    app.state.ws_manager = manager
    app.state.price_collector = collector

    # Rate limiting на /api/auth/* (ТЗ §4.3, A-08).
    limiter = RateLimiter(config.rate_limit_max, config.rate_limit_window)
    app.state.rate_limiter = limiter
    app.add_middleware(AuthRateLimitMiddleware, limiter=limiter)

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
    app.include_router(admin_affiliate.router)
    app.include_router(institutional.router)
    app.include_router(broadcast.router)
    app.include_router(pnl.router)
    app.include_router(trades.router)
    app.include_router(coins.router)
    app.include_router(shop.router)
    app.include_router(shop.admin_router)
    app.include_router(ws_routes.router)

    # Отдача загруженных файлов (картинки товаров и т.п.). Фронт подставляет API_URL
    # к путям /uploads/..., поэтому файлы грузятся с бэкенда даже при сплит-деплое.
    uploads_dir = Path(__file__).parent.parent / "webapp" / "public" / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

    @app.get("/api/health", tags=["health"])
    async def health():
        return {"status": "ok", "weex_mock": config.weex_use_mock, "ws_clients": manager.count}

    return app


app = create_app()


def main() -> None:  # pragma: no cover
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":  # pragma: no cover
    main()
