"""FastAPI-приложение NMNH (фабрика + точка входа).

Запуск: ``uvicorn backend.main:app`` или ``python -m backend.main``.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.db import init_engine, create_all, SessionLocal
from core import repo
from core.weex import get_weex_client
from backend.config import BackendConfig
from backend.api import auth, market, signals, stats, students


def create_app(config: BackendConfig | None = None, weex=None) -> FastAPI:
    config = config or BackendConfig.from_env()
    weex = weex or get_weex_client(config.weex_use_mock)

    init_engine()
    create_all()
    with SessionLocal() as session:
        repo.seed_settings(session)

    app = FastAPI(title="NMNH Platform API", version="0.1.0")
    app.state.config = config
    app.state.weex = weex

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

    @app.get("/api/health", tags=["health"])
    async def health():
        return {"status": "ok", "weex_mock": config.weex_use_mock}

    return app


app = create_app()


def main() -> None:  # pragma: no cover
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":  # pragma: no cover
    main()
