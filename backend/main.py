"""FastAPI-приложение NMNH (фабрика + точка входа).

Запуск: ``uvicorn backend.main:app`` или ``python -m backend.main``.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.db import init_engine, create_all, SessionLocal
from core import repo
from core.weex import get_weex_client
from backend.config import BackendConfig
from backend.api import auth, market, signals, stats, students, profile
from backend.ws import ConnectionManager
from backend.ws import routes as ws_routes
from backend.price_collector import PriceCollector


def create_app(config: BackendConfig | None = None, weex=None, price_interval: float = 5.0) -> FastAPI:
    config = config or BackendConfig.from_env()
    weex = weex or get_weex_client(config.weex_use_mock)

    init_engine()
    create_all()
    with SessionLocal() as session:
        repo.seed_settings(session)

    manager = ConnectionManager()
    collector = PriceCollector(weex, manager, interval=price_interval)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        collector.start()
        try:
            yield
        finally:
            await collector.stop()
            await weex.close()

    app = FastAPI(title="NMNH Platform API", version="0.1.0", lifespan=lifespan)
    app.state.config = config
    app.state.weex = weex
    app.state.ws_manager = manager
    app.state.price_collector = collector

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # для прода — ограничить доменом фронта
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(market.router)
    app.include_router(signals.router)
    app.include_router(stats.router)
    app.include_router(students.router)
    app.include_router(profile.router)
    app.include_router(ws_routes.router)

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
