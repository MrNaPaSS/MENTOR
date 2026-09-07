"""Снимки графика: сохранить, отдать картинкой и показать страницей.

Трейдер показывает график другим - наставнику, чату, себе в заметки. Пока
единственным способом был скриншот системой и пересылка файла, а файл теряет
всё: какая монета, какой таймфрейм, когда снято и чей это экран.

Ссылка решает это сразу: она открывается страницей с картинкой и подписью, а в
мессенджерах разворачивается превью - для этого страница отдаёт og-теги.

Картинка лежит файлом рядом с остальными загрузками, в базе только то, что
нужно подписи. Ссылку открывают посторонние: имени ученика и монеты им
достаточно, остального они знать не должны.
"""

from __future__ import annotations

import base64
import binascii
import re
import secrets
from datetime import timezone
from html import escape
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend.deps import get_current_student, get_session
from core.models import ChartShot, Student

router = APIRouter(prefix="/api/shots", tags=["shots"])

_DIR = Path(__file__).parent.parent.parent / "webapp" / "public" / "uploads" / "shots"

# Восемь мегабайт: снимок графика в PNG весит доли мегабайта, всё что заметно
# больше - или не снимок, или чья-то попытка занять диск.
MAX_BYTES = 8 * 1024 * 1024

_DATA_URL = re.compile(r"^data:image/png;base64,", re.IGNORECASE)


class ShotIn(BaseModel):
    """Снимок с терминала: картинка и то, что должно попасть в подпись."""

    image: str = Field(min_length=64)
    symbol: str = Field(min_length=1, max_length=32)
    interval: str = Field(default="1m", max_length=8)
    note: str = Field(default="", max_length=140)


@router.post("", status_code=201)
def save_shot(
    body: ShotIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сохранить снимок и вернуть ссылку на него."""
    raw = _DATA_URL.sub("", body.image.strip())
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, "Картинку не удалось прочитать") from exc

    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Снимок слишком большой")
    if not data.startswith(b"\x89PNG"):
        raise HTTPException(400, "Ожидается PNG")

    # Идентификатор короткий и непредсказуемый: по порядковому номеру чужие
    # снимки перебирались бы один за другим.
    shot_id = secrets.token_urlsafe(9)[:12]
    _DIR.mkdir(parents=True, exist_ok=True)
    (_DIR / f"{shot_id}.png").write_bytes(data)

    session.add(
        ChartShot(
            id=shot_id,
            symbol=body.symbol.upper(),
            interval=body.interval,
            note=body.note.strip(),
        )
    )
    session.commit()
    return {"id": shot_id, "url": f"/api/shots/{shot_id}"}


@router.get("/{shot_id}.png")
def shot_image(shot_id: str, session=Depends(get_session)):
    """Сама картинка. Открыта всем: ссылкой делятся с теми, у кого нет входа."""
    shot = session.get(ChartShot, shot_id)
    path = _DIR / f"{shot_id}.png"
    if shot is None or not path.exists():
        raise HTTPException(404, "Снимок не найден")
    return FileResponse(path, media_type="image/png")


@router.get("/{shot_id}", response_class=HTMLResponse)
def shot_page(shot_id: str, session=Depends(get_session)):
    """Страница снимка: картинка, монета, таймфрейм, автор и время.

    Отдаём готовый HTML с сервера, а не страницу приложения: ссылку открывают
    в мессенджерах, и превью там собирается по og-тегам ещё до открытия.
    """
    shot = session.execute(
        select(ChartShot).where(ChartShot.id == shot_id)
    ).scalar_one_or_none()
    if shot is None:
        raise HTTPException(404, "Снимок не найден")

    symbol = escape(shot.symbol)
    interval = escape(shot.interval)
    note = escape(shot.note or "")

    when = shot.created_at
    if when and when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    stamp = when.strftime("%d.%m.%Y %H:%M UTC") if when else ""

    title = f"{symbol} · {interval}"
    image = f"/api/shots/{shot_id}.png"

    return HTMLResponse(
        f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — NMNH</title>
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{note or 'График из терминала NMNH'}">
<meta property="og:image" content="{image}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root {{ color-scheme: dark; }}
  body {{
    margin: 0; padding: 24px; background: #0b0e11; color: #eaecef;
    font: 14px/1.5 "Inter", system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; gap: 16px;
  }}
  .card {{
    width: min(1200px, 100%); background: #181a20; border: 1px solid #2b3139;
    border-radius: 16px; overflow: hidden;
  }}
  .head {{ display: flex; align-items: baseline; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #2b3139; }}
  .sym {{ font-size: 18px; font-weight: 700; }}
  .tf {{ color: #7a8290; font-family: "JetBrains Mono", monospace; }}
  .who {{ margin-left: auto; color: #7a8290; }}
  img {{ display: block; width: 100%; height: auto; }}
  .note {{ padding: 12px 18px; color: #b7bdc6; }}
  a {{ color: #0affe0; text-decoration: none; }}
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <span class="sym">{symbol}</span>
      <span class="tf">{interval}</span>
      <span class="who">{stamp}</span>
    </div>
    <img src="{image}" alt="{title}">
    {f'<div class="note">{note}</div>' if note else ''}
  </div>
  <a href="https://www.nmnh.trade">NMNH · терминал скальпера</a>
</body>
</html>"""
    )
