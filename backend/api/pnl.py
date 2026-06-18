"""Управление PnL-скриншотами для лендинга."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from backend.deps import get_current_mentor

PNL_DIR = Path(__file__).parent.parent.parent / "webapp" / "public" / "pln"
PNL_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED = {".jpg", ".jpeg", ".png", ".webp"}

router = APIRouter(prefix="/api/pnl", tags=["pnl"])


@router.get("")
async def list_pnl():
    files = sorted(
        f.name for f in PNL_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED
    )
    return {"images": [f"/pln/{name}" for name in files]}


MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/upload", dependencies=[Depends(get_current_mentor)])
async def upload_pnl(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(400, "Только JPG, PNG или WEBP")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Файл слишком большой (макс. 10 МБ)")
    filename = f"{uuid.uuid4().hex}{ext}"
    (PNL_DIR / filename).write_bytes(data)
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
