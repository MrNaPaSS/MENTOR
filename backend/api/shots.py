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
    owner: str = Field(default="", max_length=32)
    note: str = Field(default="", max_length=140)


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
            kind="pnl",
            side=body.side,
            owner=body.owner.strip(),
        )
    )
    session.commit()
    return {"id": card_id, "url": f"{BASE_URL}/{card_id}"}


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


# Цвета карточки по стороне. Те же, что светятся на самой заготовке и что
# рисует холст: страница и картинка обязаны совпадать до оттенка.
_CARD_ACCENT = {"long": "#22E07A", "short": "#FF3B4E"}


def _card_page(shot: ChartShot, iso: str, stamp: str) -> HTMLResponse:
    """Страница карточки сделки: лист выезжает сверху, сверху падает печать.

    Движение здесь не украшение. Печать, которая просто появляется на плакате, -
    это наклейка; лист, выехавший из принтера и получивший оттиск, читается как
    заверенный документ, а карточка именно им и является: это результат сделки,
    а не картинка про неё.

    Печать рисуется разметкой, а не картинкой. Ту же печать холст ставит на
    скачиваемый PNG (`drawStamp` в webapp/lib/pnl/card.ts) - размеры здесь
    повторяют тамошние доли, и менять их нужно в обоих местах сразу.
    """
    accent = _CARD_ACCENT.get(shot.side, _CARD_ACCENT["long"])
    symbol = escape(shot.symbol)
    owner = escape(shot.owner or "")
    note = escape(shot.note or "")
    title = f"{symbol} · NMNH"
    image = f"{BASE_URL}/{shot.id}.png"
    paper = f"{BASE_URL}/{shot.id}-raw.png"

    return HTMLResponse(
        f"""<!doctype html>
<html lang="ru">
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
  @keyframes warm {{ 0% {{ opacity: 0; }} 25% {{ opacity: .9; }} 100% {{ opacity: .35; }} }}

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
    position: absolute; left: 3.13%; top: 2.70%; width: 57.97%; height: 10.45%;
    display: grid; place-items: center; pointer-events: none;
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
  .mark {{ font-size: 5.5cqw; font-weight: 800; color: var(--accent); line-height: 1; }}
  .mark small {{ display: block; font-size: .37em; font-weight: 600; opacity: .75; letter-spacing: .02em; }}
  .creed {{ font-size: 2.4cqw; font-weight: 700; color: var(--accent); opacity: .85; }}

  @keyframes slam {{
    0%   {{ transform: scale(2.4) rotate(-24deg); opacity: 0; }}
    60%  {{ opacity: 1; }}
    100% {{ transform: scale(1) rotate(-4.5deg); opacity: 1; }}
  }}
  /* Удар отдаётся в лист - коротко и почти незаметно. */
  .paper.hit {{ animation: feed 1.15s cubic-bezier(.22,.61,.36,1) .15s both, shock .18s ease-out 1.35s; }}
  @keyframes shock {{ 0%,100% {{ scale: 1; }} 40% {{ scale: 1.006; }} }}

  .who {{ display: flex; align-items: center; gap: 10px; color: #7a8290; font-size: 13px; }}
  /* Имя на подложке - так же, как оно нарисовано на самой карточке. */
  .who b {{
    color: #eaecef; font-size: 13px; font-weight: 700;
    padding: 3px 10px; border-radius: 999px;
    background: rgba(6, 10, 14, .66); border: 1px solid rgba(242, 244, 247, .16);
  }}
  .logo {{
    color: #eaecef; font-size: 22px; font-weight: 800; letter-spacing: -.02em;
    text-decoration: none; transition: color .2s ease, text-shadow .2s ease;
  }}
  .logo:hover {{ color: #fff; text-shadow: 0 0 18px var(--accent); }}

  /* Кому движение мешает - лист уже лежит, печать уже стоит. */
  @media (prefers-reduced-motion: reduce) {{
    .paper, .paper.hit, .stamp, .slot::after {{ animation: none; }}
    .stamp {{ transform: rotate(-4.5deg); }}
  }}
</style>
</head>
<body>
  <div class="slot"></div>
  <div class="window">
    <div class="paper hit">
      <img src="{paper}" alt="{title}">
      <div class="stamp">
        <div class="ink">
          <span class="mark">NMNH<small>ПОДТВЕРЖДЕНО ТЕРМИНАЛОМ</small></span>
          <span class="creed">TRADE · DISCIPLINE · PROFIT</span>
        </div>
      </div>
    </div>
  </div>
  <div class="who">
    {f'<b>{owner}</b>' if owner else ''}
    <time datetime="{iso}">{stamp}</time>
  </div>
  <a class="logo" href="https://www.nmnh.trade">NMNH</a>
<script>
  // Время - по часам того, кто смотрит, и с их поясом: без пояса одна и та же
  // сделка у отправителя и у получателя приходится на разные часы.
  (function () {{
    var node = document.querySelector("time");
    if (!node) return;
    var at = new Date(node.getAttribute("datetime"));
    if (isNaN(at)) return;
    var minutes = -at.getTimezoneOffset();
    var rest = Math.abs(minutes) % 60;
    var zone = "UTC" + (minutes < 0 ? "-" : "+") + Math.floor(Math.abs(minutes) / 60) +
      (rest ? ":" + String(rest).padStart(2, "0") : "");
    node.textContent = at.toLocaleString("ru", {{
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }}) + " " + zone;
  }})();
</script>
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

    when = shot.created_at
    if when and when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    # Время снимка в двух видах: машинное для браузера и UTC как запасное.
    #
    # Сервер живёт в UTC, а смотрит снимок человек - у себя. Час, посчитанный
    # не в его поясе, ему нечем сверить с собственным графиком, поэтому
    # окончательную подпись собирает браузер, а серверная остаётся на случай
    # выключенных скриптов.
    stamp = when.strftime("%d.%m.%Y %H:%M UTC") if when else ""
    iso = when.isoformat() if when else ""

    # Карточка сделки живёт своей страницей: у неё и движение своё, и печать.
    if shot.kind == "pnl":
        return _card_page(shot, iso, stamp)

    title = f"{symbol} · {interval}"
    image = f"{BASE_URL}/{shot_id}.png"

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
  /* Шторка узкая: она подписывает картинку, а не соперничает с ней. */
  .head {{ display: flex; align-items: baseline; gap: 10px; padding: 7px 14px; border-bottom: 1px solid #2b3139; }}
  .sym {{ font-size: 15px; font-weight: 700; }}
  .tf {{ color: #7a8290; font-family: "JetBrains Mono", monospace; font-size: 12px; }}
  .who {{ margin-left: auto; color: #7a8290; font-size: 12px; }}
  img {{ display: block; width: 100%; height: auto; }}
  .note {{ padding: 12px 18px; color: #b7bdc6; }}

  /* Знак NMNH - тот же, что в шапке сайта: жирный шрифт, глитч по цветам
     акцента и опасности, свечение под курсором. Пояснительной подписи под ним
     нет: знак и так ведёт на сайт, а объяснять логотип словами незачем. */
  /* Без рамки и подложки - одни буквы. Кнопка вокруг знака делала из него
     элемент управления, которым он не является: это подпись, ведущая домой. */
  .logo {{
    display: inline-block; padding: 4px;
    color: #eaecef; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
    text-decoration: none; transition: color .2s ease, text-shadow .2s ease;
  }}
  .logo:hover {{ color: #fff; text-shadow: 0 0 18px rgba(10, 255, 224, .75); }}
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
  /* Тем, кому движение мешает, знак стоит смирно. */
  @media (prefers-reduced-motion: reduce) {{
    .glitch::before, .glitch::after {{ animation: none; opacity: 0; }}
  }}
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <span class="sym">{symbol}</span>
      <span class="tf">{interval}</span>
      <time class="who" datetime="{iso}">{stamp}</time>
    </div>
    <img src="{image}" alt="{title}">
    {f'<div class="note">{note}</div>' if note else ''}
  </div>
  <a class="logo" href="https://www.nmnh.trade"><span class="glitch" data-text="NMNH">NMNH</span></a>
<script>
  // Время - по часам того, кто смотрит.
  (function () {{
    var node = document.querySelector("time.who");
    if (!node) return;
    var at = new Date(node.getAttribute("datetime"));
    if (isNaN(at)) return;
    node.textContent = at.toLocaleString("ru", {{
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }});
    node.title = "по вашему времени";
  }})();
</script>
</body>
</html>"""
    )
