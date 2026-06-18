"""Управление PnL-скриншотами для лендинга."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

from backend.deps import get_current_mentor

_ROOT = Path(__file__).parent.parent.parent
PNL_DIR = _ROOT / "webapp" / "public" / "pln"
PNL_OUT_DIR = _ROOT / "webapp" / "out" / "pln"
PNL_DIR.mkdir(parents=True, exist_ok=True)
PNL_OUT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED = {".jpg", ".jpeg", ".png", ".webp"}

router = APIRouter(prefix="/api/pnl", tags=["pnl"])


@router.get("")
async def list_pnl():
    files = sorted(
        f.name for f in PNL_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED
    )
    return {"images": [f"/pln/{name}" for name in files]}


@router.post("/upload", dependencies=[Depends(get_current_mentor)])
async def upload_pnl(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, "Только JPG, PNG или WEBP")
    filename = f"{uuid.uuid4().hex}{ext}"
    content = await file.read()
    (PNL_DIR / filename).write_bytes(content)
    (PNL_OUT_DIR / filename).write_bytes(content)
    return {"url": f"/pln/{filename}"}


@router.delete("/{filename}", dependencies=[Depends(get_current_mentor)])
async def delete_pnl(filename: str):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Недопустимое имя файла")
    found = False
    for directory in (PNL_DIR, PNL_OUT_DIR):
        p = directory / filename
        if p.exists():
            p.unlink()
            found = True
    if not found:
        raise HTTPException(404, "Файл не найден")
    return {"ok": True}
