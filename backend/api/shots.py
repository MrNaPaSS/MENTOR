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
import json
import os
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

# Ссылка на снимок - короткая и без служебных слов: её отправляют людям, а не
# программам. Отсюда путь прямо в корне, «api» и «shots» в нём не нужны.
#
# Адрес берётся из окружения: когда снимки начнут отдаваться с основного
# домена, ссылки станут красивее без единой правки кода.
router = APIRouter(tags=["shots"])
api_router = APIRouter(prefix="/api/shots", tags=["shots"])

BASE_URL = (os.getenv("SHOTS_BASE_URL", "") or "").rstrip("/")

# Куда ведёт кнопка со страницы карточки. Отдельно от BASE_URL: картинки отдаёт
# бэкенд, а терминал живёт на сайте, и это разные адреса.
SITE_URL = (os.getenv("SITE_URL", "https://www.nmnh.trade") or "").rstrip("/")


def _terminal_url(symbol: str) -> str:
    """Ссылка в терминал на эту монету. Пусто - монета невнятная."""
    clean = "".join(c for c in (symbol or "").upper() if c.isalnum())
    return f"{SITE_URL}/app/scalping?symbol={clean}" if clean and SITE_URL else ""

# Идентификатор снимка: буквы, цифры, дефис и подчёркивание. Ограничение нужно
# не для красоты - без него путь в корне перехватывал бы чужие адреса.
_DIR = Path(__file__).parent.parent.parent / "webapp" / "public" / "uploads" / "shots"

# Восемь мегабайт: снимок графика в PNG весит доли мегабайта, всё что заметно
# больше - или не снимок, или чья-то попытка занять диск.
MAX_BYTES = 8 * 1024 * 1024

_DATA_URL = re.compile(r"^data:image/png;base64,", re.IGNORECASE)
_ID_OK = re.compile(r"^[A-Za-z0-9_-]{8,16}$")

# Первые байты PNG. По ним отличаем картинку от чего угодно другого, что
# прислали под её видом.
PNG_MAGIC = bytes([0x89]) + b"PNG"


class ShotIn(BaseModel):
    """Снимок с терминала: картинка и то, что должно попасть в подпись."""

    image: str = Field(min_length=64)
    symbol: str = Field(min_length=1, max_length=32)
    interval: str = Field(default="1m", max_length=8)
    note: str = Field(default="", max_length=140)


@api_router.post("", status_code=201)
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
    if not data.startswith(PNG_MAGIC):
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
    return {"id": shot_id, "url": f"{BASE_URL}/{shot_id}"}


class CardFrame(BaseModel):
    """Прямоугольник в долях ширины и высоты карточки."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class CardLook(BaseModel):
    """Чем страница отличает одну заготовку от другой."""

    variant: str = Field(default="", max_length=24)
    # Цвет печати. Проверяем строго: это значение уходит прямо в стили
    # страницы, и чужая строка там - открытая дверь.
    ink: str = Field(default="#22E07A", pattern="^#[0-9A-Fa-f]{6}$")
    stamp: CardFrame


class CardIn(BaseModel):
    """Карточка сделки: две картинки одной и той же карточки.

    `image` - с печатью: её отдаёт превью в мессенджере и её же скачивают.
    `raw` - без печати: страница печатает лист движением, и печать падает на
    него отдельно, уже в браузере. Собрать вторую из первой нельзя - печать
    непрозрачна, - поэтому приезжают обе.
    """

    image: str = Field(min_length=64)
    raw: str = Field(min_length=64)
    symbol: str = Field(min_length=1, max_length=32)
    side: str = Field(pattern="^(long|short)$")
    # Какой бланк напечатан: итог сделки или сигнал. Печать у них разная -
    # у итога наборная, у сигнала оттиск логотипа, - и страница обязана знать
    # об этом до того, как начнёт собираться.
    kind: str = Field(default="pnl", pattern="^(pnl|signal)$")
    owner: str = Field(default="", max_length=32)
    note: str = Field(default="", max_length=140)
    # Куда странице ставить печать и каким цветом. Числами, а не именем
    # заготовки: держать те же доли ещё и здесь значит однажды их разойти.
    card: CardLook | None = None


def _png(payload: str) -> bytes:
    """Картинка из data-URL. Отказ словами: это приходит снаружи."""
    raw = _DATA_URL.sub("", payload.strip())
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, "Картинку не удалось прочитать") from exc
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Картинка слишком большая")
    if not data.startswith(PNG_MAGIC):
        raise HTTPException(400, "Ожидается PNG")
    return data


@api_router.post("/pnl", status_code=201)
def save_card(
    body: CardIn,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Сохранить карточку сделки и вернуть ссылку на неё."""
    stamped = _png(body.image)
    plain = _png(body.raw)

    card_id = secrets.token_urlsafe(9)[:12]
    _DIR.mkdir(parents=True, exist_ok=True)
    (_DIR / f"{card_id}.png").write_bytes(stamped)
    (_DIR / f"{card_id}-raw.png").write_bytes(plain)

    session.add(
        ChartShot(
            id=card_id,
            symbol=body.symbol.upper(),
            interval="",
            note=body.note.strip(),
            kind=body.kind,
            side=body.side,
            owner=body.owner.strip(),
            card_json=body.card.model_dump_json() if body.card else "",
        )
    )
    session.commit()
    return {"id": card_id, "url": f"{BASE_URL}/{card_id}"}


# Первые байты JPEG. Так фотография из Telegram отличается от чего угодно
# другого, что прислали под её видом.
JPEG_MAGIC = bytes([0xFF, 0xD8, 0xFF])


def save_photo(data: bytes, symbol: str = "", note: str = "") -> str:
    """Сохранить пришедшую снаружи фотографию и вернуть её идентификатор.

    Нужна мосту с форумом: фотографию из темы бот забирает у Telegram, а жить
    она должна там же, где снимки с терминала, - их отдаёт этот сервер, и
    браузер ученика достаёт их без всякого токена.

    Отдельно от ``save_shot``: та ручка живёт под входом ученика и принимает
    только PNG с холста, а из Telegram приходит JPEG и приходит от сервера.
    """
    if data.startswith(PNG_MAGIC):
        ext = "png"
    elif data.startswith(JPEG_MAGIC):
        ext = "jpg"
    else:
        raise HTTPException(400, "Ожидается PNG или JPEG")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Картинка слишком большая")

    shot_id = secrets.token_urlsafe(9)[:12]
    _DIR.mkdir(parents=True, exist_ok=True)
    (_DIR / f"{shot_id}.{ext}").write_bytes(data)
    return f"{shot_id}.{ext}"


@router.get("/{shot_id}.jpg", include_in_schema=False)
def shot_photo(shot_id: str):
    """Фотография, пришедшая из форума. Открыта всем, как и снимки.

    Записи в таблице у неё нет: подписывать её нечем - ни монеты, ни таймфрейма
    из чужого сообщения не известно, - а страницы у неё и не должно быть. В
    ленте она открывается сама собой.
    """
    if not _ID_OK.match(shot_id):
        raise HTTPException(404, "Снимок не найден")
    path = _DIR / f"{shot_id}.jpg"
    if not path.exists():
        raise HTTPException(404, "Снимок не найден")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/{shot_id}.png", include_in_schema=False)
def shot_image(shot_id: str, session=Depends(get_session)):
    """Сама картинка. Открыта всем: ссылкой делятся с теми, у кого нет входа.

    Лист без печати лежит под тем же именем с хвостом `-raw`: страница берёт
    его, чтобы поставить печать движением уже в браузере.
    """
    name = shot_id
    key = shot_id[: -len("-raw")] if shot_id.endswith("-raw") else shot_id
    if not _ID_OK.match(key):
        raise HTTPException(404, "Снимок не найден")
    shot = session.get(ChartShot, key)
    path = _DIR / f"{name}.png"
    if shot is None or not path.exists():
        raise HTTPException(404, "Снимок не найден")
    return FileResponse(path, media_type="image/png")


# Как выглядит карточка, если запись об этом молчит. Так лежат карточки,
# сделанные до того, как заготовок стало несколько.
_CARD_FALLBACK = {
    "long": {"ink": "#22E07A"},
    "short": {"ink": "#FF3B4E"},
}
_STAMP_FALLBACK = {"x": 20 / 640, "y": 23 / 852, "w": 371 / 640, "h": 89 / 852}


def _card_look(shot: ChartShot) -> tuple[str, dict[str, float]]:
    """Цвет печати и её место в долях - из записи, а не из таблицы здесь.

    Числа приходят оттуда же, откуда рисуется сама карточка. Держать их копию
    на сервере значит однажды нарисовать новую заготовку и получить печать
    мимо рамки.
    """
    ink = _CARD_FALLBACK.get(shot.side, _CARD_FALLBACK["long"])["ink"]
    box = dict(_STAMP_FALLBACK)
    try:
        saved = json.loads(shot.card_json or "null")
    except (TypeError, ValueError):
        saved = None
    if isinstance(saved, dict):
        if re.fullmatch(r"#[0-9A-Fa-f]{6}", str(saved.get("ink", ""))):
            ink = str(saved["ink"])
        frame = saved.get("stamp")
        if isinstance(frame, dict):
            try:
                box = {k: float(frame[k]) for k in ("x", "y", "w", "h")}
            except (KeyError, TypeError, ValueError):
                box = dict(_STAMP_FALLBACK)
    return ink, box


def _card_page(shot: ChartShot) -> HTMLResponse:
    """Страница карточки сделки: лист выезжает сверху, сверху падает печать.

    Движение здесь не украшение. Печать, которая просто появляется на плакате, -
    это наклейка; лист, выехавший из принтера и получивший оттиск, читается как
    заверенный документ, а карточка именно им и является: это результат сделки,
    а не картинка про неё.

    Печать рисуется разметкой, а не картинкой. Ту же печать холст ставит на
    скачиваемый PNG (`drawStamp` в webapp/lib/pnl/card.ts) - размеры здесь
    повторяют тамошние доли, и менять их нужно в обоих местах сразу.
    """
    accent, box = _card_look(shot)
    symbol = escape(shot.symbol)
    note = escape(shot.note or "")
    title = f"{symbol} · NMNH"
    image = f"{BASE_URL}/{shot.id}.png"
    paper = f"{BASE_URL}/{shot.id}-raw.png"

    # Кнопка в терминал. Появляется последней, когда лист уже напечатан:
    # предлагать действие раньше, чем человек прочёл карточку, - это торопить
    # его решение, а решение здесь про деньги.
    go = _terminal_url(shot.symbol)
    button = (
        f'<a class="go" href="{go}">Перейти к терминалу</a>' if go else ""
    )

    # Оттиск. У сигнала это тот же логотип, который холст ставит на скачиваемую
    # картинку, - иначе страница и картинка заверялись бы разными печатями.
    if shot.kind == "signal":
        ink = (
            '<img class="graffiti" src="' + SITE_URL + '/cards/signal-stamp.png" alt="NMNH">'
        )
    else:
        ink = (
            '<span class="mark">NMNH</span>'
            '<span class="creed"><small>ПОДТВЕРЖДЕНО ТЕРМИНАЛОМ</small>'
            'TRADE · DISCIPLINE · PROFIT</span>'
        )

    return HTMLResponse(
        f"""<!doctype html>
<html lang="ru" data-paper="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{note or 'Сделка из терминала NMNH'}">
<meta property="og:image" content="{image}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root {{ color-scheme: dark; --accent: {accent}; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; padding: 28px 16px 40px;
    background: radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,.06), transparent 60%), #06080b;
    color: #eaecef; font: 14px/1.5 "Inter", system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; gap: 18px;
  }}

  /* Щель принтера: тонкая полоса, из которой выходит лист. Без неё движение
     читается как «картинка приехала», а не как «её напечатали». */
  .slot {{
    width: min(420px, 92vw); height: 10px; border-radius: 6px;
    background: linear-gradient(180deg, #12161b, #04060a);
    box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 10px 30px rgba(0,0,0,.6);
    position: relative; z-index: 3;
  }}
  .slot::after {{
    content: ""; position: absolute; inset: 3px 10px auto; height: 2px;
    border-radius: 2px; background: var(--accent); opacity: .5;
    animation: warm 1.1s ease-out both;
  }}
  @keyframes warm {{ 0% {{ opacity: 0; }} 25% {{ opacity: 1; }} 100% {{ opacity: .5; }} }}

  /* Окно, из которого лист выезжает: оно и обрезает его сверху. */
  .window {{ width: min(420px, 92vw); margin-top: -10px; overflow: hidden; padding-top: 10px; }}

  .paper {{
    position: relative; container-type: inline-size;
    border-radius: 10px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,.65);
    animation: feed 1.15s cubic-bezier(.22,.61,.36,1) .15s both;
    transform-origin: 50% 0;
  }}
  .paper img {{ display: block; width: 100%; height: auto; }}

  /* Лист идёт рывками - валик принтера тянет его не ровно. */
  @keyframes feed {{
    0%   {{ transform: translateY(-101%) rotate(.6deg); }}
    18%  {{ transform: translateY(-78%)  rotate(-.5deg); }}
    36%  {{ transform: translateY(-52%)  rotate(.4deg); }}
    54%  {{ transform: translateY(-28%)  rotate(-.3deg); }}
    72%  {{ transform: translateY(-11%)  rotate(.2deg); }}
    88%  {{ transform: translateY(-2%)   rotate(-.1deg); }}
    100% {{ transform: translateY(0) rotate(0); }}
  }}

  /* Печать. Доли те же, что у холста: рамка на заготовке 20..391 x 23..112
     при 640x852 - отсюда и проценты, и размеры в cqw. */
  .stamp {{
    position: absolute;
    left: {box["x"] * 100:.4f}%; top: {box["y"] * 100:.4f}%;
    width: {box["w"] * 100:.4f}%; height: {box["h"] * 100:.4f}%;
    display: grid; place-items: center; pointer-events: none;
    /* Наклон - свойство самой печати, а не хвост анимации: не сыграет она -
       оттиск всё равно должен сидеть косо, иначе это не печать, а бланк. */
    transform: rotate(-4.5deg);
    animation: slam .42s cubic-bezier(.2,1.5,.35,1) 1.35s both;
  }}
  .ink {{
    position: relative; width: 92%; height: 86%;
    border: .5cqw solid var(--accent);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 1.6cqw; opacity: .9;
  }}
  .ink::before {{
    content: ""; position: absolute; inset: 1.4cqw;
    border: .18cqw solid var(--accent); opacity: .85;
  }}
  /* Оттиск в две колонки: слева имя, справа две строки мелким. Подпись
     «подтверждено терминалом» стоит над девизом, а не под именем: под именем
     она удлиняла левую колонку, и та доставала до девиза. Здесь то же
     разбиение, что рисует холст (drawStamp в webapp/lib/pnl/card.ts). */
  .mark {{ font-size: 5.5cqw; font-weight: 800; color: var(--accent); line-height: 1; }}
  .creed {{
    display: flex; flex-direction: column; align-items: flex-end; gap: .3cqw;
    font-size: 2.4cqw; font-weight: 700; color: var(--accent); opacity: .85;
    line-height: 1; text-align: right;
  }}
  .creed small {{ font-size: .82em; font-weight: 600; opacity: .85; letter-spacing: .02em; }}

  @keyframes slam {{
    0%   {{ transform: scale(2.4) rotate(-24deg); opacity: 0; }}
    60%  {{ opacity: 1; }}
    100% {{ transform: scale(1) rotate(-4.5deg); opacity: 1; }}
  }}
  /* Удар отдаётся в лист - коротко и почти незаметно. */
  .paper.hit {{ animation: feed 1.15s cubic-bezier(.22,.61,.36,1) .15s both, shock .18s ease-out 1.35s; }}
  @keyframes shock {{ 0%,100% {{ scale: 1; }} 40% {{ scale: 1.006; }} }}

  /* Лист под светлой карточкой.
     Заготовки бывают двух видов - на тёмной бумаге и на светлой, - а какая
     пришла, страница не знает: в записи этого нет. Определяет скрипт внизу по
     самой картинке. Тёмный лист вокруг белой карточки выглядит вырезанным из
     другого приложения. */
  /* Лист под карточкой - всегда светлый, в клетку.
     Это та же бумага, что на странице снимка графика и на входе: ссылку
     открывает посторонний, и он должен попадать в одно и то же место, а не в
     разное в зависимости от того, чем поделились. Сама карточка при этом
     какая есть - тёмная со зверем или светлая с графиком. */
  :root[data-paper="light"] body {{
    background: radial-gradient(120% 80% at 50% -10%, rgba(126,87,194,.06), transparent 60%), #f4f5f8;
    color: #111418;
  }}
  /* Сетка отдельным слоем и с маской: она гаснет к краям, а не упирается в
     них обрезанной клеткой. Слоем - потому что маска на самом теле съела бы и
     содержимое. */
  :root[data-paper="light"] body::before {{
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      linear-gradient(to right, rgba(42,42,62,.055) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(42,42,62,.055) 1px, transparent 1px);
    background-size: 48px 48px;
    -webkit-mask-image: radial-gradient(75% 60% at 50% 38%, #000 35%, transparent 100%);
    mask-image: radial-gradient(75% 60% at 50% 38%, #000 35%, transparent 100%);
  }}
  .slot, .window, .logo {{ position: relative; z-index: 1; }}
  :root[data-paper="light"] .slot {{
    box-shadow: 0 0 0 1px rgba(17,20,24,.1), 0 10px 26px rgba(17,20,24,.16);
  }}
  :root[data-paper="light"] .paper {{ box-shadow: 0 24px 60px rgba(17,20,24,.2); }}
  :root[data-paper="light"] .logo {{ color: #111418; }}
  :root[data-paper="light"] .logo:hover {{ color: #000; }}

  /* Под карточкой - только знак. Имя и время на ней уже нарисованы, и
     повторять их подписью значит спорить с самой карточкой. */
  .logo {{
    color: #eaecef; font-size: 22px; font-weight: 800; letter-spacing: -.02em;
    text-decoration: none; transition: color .2s ease, text-shadow .2s ease;
  }}
  .logo:hover {{ color: #fff; text-shadow: 0 0 18px var(--accent); }}
  /* Глитч - тот же, что у знака в шапке сайта. */
  .glitch {{ position: relative; display: inline-block; }}
  .glitch::before, .glitch::after {{
    content: attr(data-text); position: absolute; inset: 0;
    pointer-events: none; opacity: .85;
  }}
  .glitch::before {{
    color: #0affe0; animation: glitch-x 3.4s infinite steps(2, end);
    clip-path: inset(0 0 60% 0);
  }}
  .glitch::after {{
    color: #f6465d; animation: glitch-y 2.8s infinite steps(2, end);
    clip-path: inset(60% 0 0 0);
  }}
  @keyframes glitch-x {{
    0%, 86%, 100% {{ transform: translate(0); opacity: 0; }}
    88% {{ transform: translate(-3px, -1px); opacity: .9; }}
    92% {{ transform: translate(3px, 1px); opacity: .9; }}
    96% {{ transform: translate(-2px, 1px); opacity: .6; }}
  }}
  @keyframes glitch-y {{
    0%, 86%, 100% {{ transform: translate(0); opacity: 0; }}
    89% {{ transform: translate(3px, 1px); opacity: .9; }}
    93% {{ transform: translate(-3px, -1px); opacity: .9; }}
    97% {{ transform: translate(2px, -1px); opacity: .6; }}
  }}

  /* Кому движение мешает - лист уже лежит, печать уже стоит. */
  /* Оттиск-логотип у карточки сигнала: он светлый, потому что рамка под ним
     на бланке тёмная. Тот же файл холст ставит на скачиваемую картинку. */
  .graffiti {{
    width: 82%; height: auto; object-fit: contain;
    filter: brightness(0) invert(1) drop-shadow(0 0 6px var(--accent));
    opacity: .95;
  }}

  /* Кнопка в терминал: появляется после того, как лист напечатан. */
  .go {{
    position: relative; z-index: 2;
    display: inline-block; padding: 11px 22px; border-radius: 999px;
    background: var(--accent); color: #05070a;
    font-weight: 700; font-size: 13px; letter-spacing: .02em;
    text-decoration: none; white-space: nowrap;
    box-shadow: 0 10px 30px rgba(0,0,0,.45);
    transition: transform .15s ease-out, filter .15s ease-out;
    animation: offer .5s ease-out 1.5s both;
  }}
  .go:hover {{ transform: translateY(-1px); filter: brightness(1.08); }}
  .go:active {{ transform: translateY(0) scale(.985); }}
  @keyframes offer {{
    from {{ opacity: 0; transform: translateY(8px); }}
    to   {{ opacity: 1; transform: translateY(0); }}
  }}

  @media (prefers-reduced-motion: reduce) {{
    .paper, .paper.hit, .stamp, .slot::after, .go,
    .glitch::before, .glitch::after {{ animation: none; }}
  }}
</style>
</head>
<body>
  <div class="slot"></div>
  <div class="window">
    <div class="paper hit">
      <img src="{paper}" alt="{title}">
      <div class="stamp">
        <div class="ink">{ink}</div>
      </div>
    </div>
  </div>
  {button}
  <a class="logo" href="https://www.nmnh.trade"><span class="glitch" data-text="NMNH.TRADE">NMNH.TRADE</span></a>
</body>
</html>"""
    )


@router.get("/{shot_id}", response_class=HTMLResponse, include_in_schema=False)
def shot_page(shot_id: str, session=Depends(get_session)):
    """Страница снимка: картинка, монета, таймфрейм, автор и время.

    Отдаём готовый HTML с сервера, а не страницу приложения: ссылку открывают
    в мессенджерах, и превью там собирается по og-тегам ещё до открытия.
    """
    if not _ID_OK.match(shot_id):
        raise HTTPException(404, "Снимок не найден")
    shot = session.execute(
        select(ChartShot).where(ChartShot.id == shot_id)
    ).scalar_one_or_none()
    if shot is None:
        raise HTTPException(404, "Снимок не найден")

    symbol = escape(shot.symbol)
    interval = escape(shot.interval)
    note = escape(shot.note or "")

    # Карточка сделки живёт своей страницей: у неё и движение своё, и печать.
    if shot.kind in ("pnl", "signal"):
        return _card_page(shot)

    title = f"{symbol} · {interval}"
    image = f"{BASE_URL}/{shot_id}.png"
    caption = f'<div class="note">{note}</div>' if note else ""

    return HTMLResponse(
        f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · NMNH</title>
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{note or 'График из терминала NMNH'}">
<meta property="og:image" content="{image}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root {{ color-scheme: dark; --accent: #0affe0; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; padding: 28px 16px 40px;
    background: radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,.05), transparent 60%), #06080b;
    color: #eaecef; font: 14px/1.5 "Inter", system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; gap: 18px;
  }}

  /* Лист под светлым снимком.
     Снимок бывает и на белом, и на чёрном, а тема в записи не хранится - её
     определяет скрипт внизу по самой картинке. Тёмный лист вокруг белого
     графика выглядел вырезанным из другого приложения; здесь под ним та же
     бумага в клетку, что на странице входа. */
  :root[data-paper="light"] body {{
    background: radial-gradient(120% 80% at 50% -10%, rgba(126,87,194,.06), transparent 60%), #f4f5f8;
    color: #111418;
  }}
  /* Сетка отдельным слоем и с маской: она должна гаснуть к краям, а не
     упираться в них обрезанной клеткой. Ровно так же она сделана на странице
     входа. Слоем - потому что маска на самом теле съела бы и содержимое. */
  :root[data-paper="light"] body::before {{
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      linear-gradient(to right, rgba(42,42,62,.055) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(42,42,62,.055) 1px, transparent 1px);
    background-size: 48px 48px;
    -webkit-mask-image: radial-gradient(75% 60% at 50% 38%, #000 35%, transparent 100%);
    mask-image: radial-gradient(75% 60% at 50% 38%, #000 35%, transparent 100%);
  }}
  /* Содержимое - поверх сетки. */
  .slot, .window, .note, .logo {{ position: relative; z-index: 1; }}
  :root[data-paper="light"] .slot {{
    box-shadow: 0 0 0 1px rgba(17,20,24,.1), 0 10px 26px rgba(17,20,24,.16);
  }}
  :root[data-paper="light"] .paper {{
    border-color: rgba(17,20,24,.14);
    box-shadow: 0 24px 60px rgba(17,20,24,.18);
  }}
  :root[data-paper="light"] .note {{ color: #4a5058; }}
  :root[data-paper="light"] .logo {{ color: #111418; }}
  :root[data-paper="light"] .logo:hover {{ color: #000; }}

  /* Верхней шторки нет намеренно. Пара, таймфрейм, автор и время нарисованы в
     самой картинке - подпись над ней повторяла их слово в слово. */

  /* Щель принтера: тонкая полоса, из которой выходит лист. Без неё движение
     читается как «картинка приехала», а не как «её напечатали». */
  .slot {{
    width: min(1200px, 96vw); height: 10px; border-radius: 6px;
    background: linear-gradient(180deg, #12161b, #04060a);
    box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 10px 30px rgba(0,0,0,.6);
    position: relative; z-index: 3;
  }}
  /* Внутри щели - тусклый блик, а не бирюзовая подсветка: это прорезь в
     корпусе, из которой идёт лист, и светиться ей незачем. */
  .slot::after {{
    content: ""; position: absolute; inset: 3px 10px auto; height: 2px;
    border-radius: 2px; background: rgba(255,255,255,.18);
    animation: warm 1.1s ease-out both;
  }}
  @keyframes warm {{ 0% {{ opacity: 0; }} 25% {{ opacity: 1; }} 100% {{ opacity: .5; }} }}

  /* Окно, из которого лист выезжает: оно и обрезает его сверху. */
  .window {{ width: min(1200px, 96vw); margin-top: -10px; overflow: hidden; padding-top: 10px; }}

  /* Лист прямоугольный, с рамкой.
     Скругление срезало углы самого графика: под ним свечи и подписи, и
     закруглять их нечем - выходит подрезанная картинка. Рамка при этом нужна:
     без неё белый лист сливается с листом страницы. */
  .paper {{
    position: relative; container-type: inline-size;
    border: 1px solid rgba(255,255,255,.1);
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,.65);
    animation: feed .95s cubic-bezier(.16,.84,.3,1) .1s both;
    transform-origin: 50% 0;
    will-change: transform;
  }}
  .paper img {{ display: block; width: 100%; height: auto; }}

  /* Одно движение вместо семи.
     У карточки лист узкий, и рывки валика читаются как печать. Здесь лист во
     всю ширину экрана: те же рывки с поворотом болтали его углы на десятки
     пикселей - выходила не печать, а тряска. Осталось ровное скольжение и
     короткая осадка в конце: лист доходит до упора и встаёт. */
  @keyframes feed {{
    0%   {{ transform: translateY(-100%); }}
    82%  {{ transform: translateY(.9%); }}
    100% {{ transform: translateY(0); }}
  }}

  /* Печать в правом нижнем углу графика. Размеры в cqw - в долях ширины
     самого листа, поэтому оттиск одинаков и на мониторе, и на телефоне.
     Полупрозрачная: это оттиск на графике, а не наклейка поверх него, и
     свечи под ней должны просвечивать. */
  .stamp {{
    position: absolute; right: 3.5%; bottom: 7%;
    width: 17.5%; aspect-ratio: 3.1 / 1;
    display: grid; place-items: center; pointer-events: none;
    animation: slam .4s cubic-bezier(.2,1.5,.35,1) 1.05s both;
    /* Смешивание задано здесь, а не на самом оттиске: поворот печати заводит
       ей собственный слой, и разность внутри него сравнивалась бы с пустотой -
       печать пропадала целиком. */
    mix-blend-mode: difference; opacity: .75;
  }}
  /* Оттиск белым в разностном смешивании.
     Снимок бывает и на белом листе светлой темы, и на чёрном - какой именно,
     страница не знает: тема в записи не хранится. Любой один цвет пропадал бы
     на половине снимков: бирюза на белом почти не видна. Разность инвертирует
     оттиск под тем, что под ним, - на белом он выходит тёмным, на тёмном
     светлым, и читается всегда. */
  .ink {{
    position: relative; width: 100%; height: 100%;
    border: .28cqw solid #fff;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: .35cqw; color: #fff;
  }}
  .ink::before {{
    content: ""; position: absolute; inset: .72cqw;
    border: .1cqw solid #fff; opacity: .8;
  }}
  .mark {{
    font-size: 1.7cqw; font-weight: 800; letter-spacing: .02em; line-height: 1;
  }}
  .creed {{
    font-size: .86cqw; font-weight: 600; letter-spacing: .08em;
    opacity: .85; line-height: 1;
  }}

  @keyframes slam {{
    0%   {{ transform: scale(2.4) rotate(-24deg); opacity: 0; }}
    60%  {{ opacity: 1; }}
    100% {{ transform: scale(1) rotate(-4.5deg); opacity: 1; }}
  }}

  .note {{ color: #b7bdc6; max-width: min(1200px, 96vw); text-align: center; }}

  /* Знак NMNH - тот же, что в шапке сайта: одни буквы, глитч, свечение под
     курсором. Пояснительной подписи под ним нет: он и так ведёт на сайт. */
  .logo {{
    display: inline-block; padding: 4px;
    color: #eaecef; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
    text-decoration: none; transition: color .2s ease, text-shadow .2s ease;
  }}
  .logo:hover {{ color: #fff; text-shadow: 0 0 18px var(--accent); }}
  .glitch {{ position: relative; display: inline-block; }}
  .glitch::before, .glitch::after {{
    content: attr(data-text); position: absolute; inset: 0;
    pointer-events: none; opacity: .85;
  }}
  .glitch::before {{
    color: #0affe0; animation: glitch-x 3.4s infinite steps(2, end);
    clip-path: inset(0 0 60% 0);
  }}
  .glitch::after {{
    color: #f6465d; animation: glitch-y 2.8s infinite steps(2, end);
    clip-path: inset(60% 0 0 0);
  }}
  @keyframes glitch-x {{
    0%, 86%, 100% {{ transform: translate(0); opacity: 0; }}
    88% {{ transform: translate(-3px, -1px); opacity: .9; }}
    92% {{ transform: translate(3px, 1px); opacity: .9; }}
    96% {{ transform: translate(-2px, 1px); opacity: .6; }}
  }}
  @keyframes glitch-y {{
    0%, 86%, 100% {{ transform: translate(0); opacity: 0; }}
    89% {{ transform: translate(3px, 1px); opacity: .9; }}
    93% {{ transform: translate(-3px, -1px); opacity: .9; }}
    97% {{ transform: translate(2px, -1px); opacity: .6; }}
  }}

  /* Кому движение мешает - лист уже лежит, печать уже стоит. */
  @media (prefers-reduced-motion: reduce) {{
    .paper, .stamp, .slot::after, .glitch::before, .glitch::after {{ animation: none; }}
    .stamp {{ transform: rotate(-4.5deg); }}
    .glitch::before, .glitch::after {{ opacity: 0; }}
  }}
</style>
</head>
<body>
  <div class="slot"></div>
  <div class="window">
    <div class="paper">
      <img src="{image}" alt="{title}">
      <div class="stamp">
        <div class="ink">
          <span class="mark">NMNH.ORIGINAL</span>
          <span class="creed">Just by trade</span>
        </div>
      </div>
    </div>
  </div>
  {caption}
  <a class="logo" href="https://www.nmnh.trade"><span class="glitch" data-text="NMNH.TRADE">NMNH.TRADE</span></a>
<script>
  // Тема снимка - по самой картинке.
  //
  // В записи её нет, а лист вокруг должен быть той же светлости, что и график:
  // тёмная страница вокруг белого графика выглядит вырезанной из другого
  // приложения. Смотрим на угол картинки: там поле графика, без свечей и
  // подписей. Картинка своя, с этого же адреса, поэтому холст не портится и
  // пиксель читается.
  (function () {{
    var img = document.querySelector(".paper img");
    if (!img) return;
    function decide() {{
      try {{
        var c = document.createElement("canvas");
        c.width = c.height = 1;
        var ctx = c.getContext("2d");
        if (!ctx) return;
        // Берём точку внутри поля, отступив от краёв: по самому краю идёт рамка.
        ctx.drawImage(img, Math.round(img.naturalWidth * 0.5), Math.round(img.naturalHeight * 0.12), 1, 1, 0, 0, 1, 1);
        var px = ctx.getImageData(0, 0, 1, 1).data;
        var light = (px[0] * 299 + px[1] * 587 + px[2] * 114) / 1000 > 140;
        if (light) document.documentElement.dataset.paper = "light";
      }} catch (e) {{
        // Не прочиталось - остаёмся на тёмном листе, как было.
      }}
    }}
    if (img.complete && img.naturalWidth) decide();
    else img.addEventListener("load", decide);
  }})();
</script>
</body>
</html>"""
    )
