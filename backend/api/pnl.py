"""Управление PnL-скриншотами для лендинга."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from backend.deps import get_current_mentor

_ROOT = Path(__file__).parent.parent.parent
PNL_DIR = _ROOT / "webapp" / "public" / "pln"
PNL_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED = {".jpg", ".jpeg", ".png", ".webp"}

router = APIRouter(prefix="/api/pnl", tags=["pnl"])


def _backend_url() -> str:
    tunnel = _ROOT / "tunnel.config"
    if tunnel.exists():
        for line in tunnel.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("NGROK_DOMAIN="):
                domain = line.split("=", 1)[1].strip()
                if domain:
                    return f"https://{domain}"
    return os.getenv("BACKEND_URL", "http://localhost:8000")


@router.get("")
async def list_pnl():
    base = _backend_url()
    files = sorted(
        f.name for f in PNL_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED
    )
    return {"images": [f"{base}/pln/{name}" for name in files]}


@router.post("/upload", dependencies=[Depends(get_current_mentor)])
async def upload_pnl(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, "Только JPG, PNG или WEBP")
    filename = f"{uuid.uuid4().hex}{ext}"
    (PNL_DIR / filename).write_bytes(await file.read())
    return {"url": f"/pln/{filename}"}


@router.delete("/{filename}", dependencies=[Depends(get_current_mentor)])
async def delete_pnl(filename: str):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Недопустимое имя файла")
    path = PNL_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Файл не найден")
    path.unlink()
    return {"ok": True}
