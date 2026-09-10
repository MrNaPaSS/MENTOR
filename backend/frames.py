"""Рамки аватара: какие бывают и какие продаются.

Рамка - оформление, а не функция: её видят другие в чате, профиле и
лидерборде. Покупается в маркете навсегда (доступ ``frame_<id>``), надевается
одна за раз (``Student.avatar_frame``).

Золото, серебро и бронза не продаются вовсе: их носят первые три места
лидерборда, и купить место за монеты нельзя.
"""

from __future__ import annotations

# Рамки магазина: ключ -> название. Ключи те же, что в webapp/lib/frames.ts.
FRAMES: dict[str, str] = {
    "neon": "Неон",
    "carbon": "Карбон",
    "pulse": "Пульс",
    "candles": "Свечи",
    "crown": "Корона",
}

RANK_FRAMES = ("gold", "silver", "bronze")

FEATURE_PREFIX = "frame_"


def feature_of(frame: str) -> str:
    return f"{FEATURE_PREFIX}{frame}"


def frame_of(feature: str | None) -> str | None:
    """Рамка, которую открывает доступ, или None, если доступ не про рамку."""
    if not feature or not feature.startswith(FEATURE_PREFIX):
        return None
    frame = feature[len(FEATURE_PREFIX):]
    return frame if frame in FRAMES else None
