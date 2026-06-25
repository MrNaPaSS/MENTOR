"""Управление PnL-скриншотами для лендинга.

Картинки отдаются как data-URL (base64) внутри JSON: фронт на Render и бэкенд на
домашнем сервере (через ngrok) — разные хосты, а `<img src="/pln/...">` искал бы
файл не там. К тому же ngrok-free перехватывает прямые запросы картинок из браузера
и отдаёт HTML-заглушку. data-URL рендерится инлайн и обходит обе проблемы. Файлы
по-прежнему хранятся на диске бэкенда.
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from backend.deps import get_current_mentor

PNL_DIR = Path(__file__).parent.parent.parent / "webapp" / "public" / "pln"
PNL_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED = {".jpg", ".jpeg", ".png", ".webp"}
_MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}

router = APIRouter(prefix="/api/pnl", tags=["pnl"])


def _data_url(path: Path) -> str:
    mime = _MIME.get(path.suffix.lower(), "image/jpeg")
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


@router.get("")
async def list_pnl():
    files = sorted(
        f for f in PNL_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ALLOWED
    )
    return {"images": [{"name": f.name, "url": _data_url(f)} for f in files]}


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
