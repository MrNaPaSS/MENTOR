"""Просьба терминала проверить сделки сейчас, а не в очередь обхода.

Стоп в безубыток после первой цели переставляет серверное сопровождение, и
делает оно это на своём обходе. Терминал же видит взятую цель раньше: он
спрашивает биржу раз в несколько секунд по той монете, что открыта на экране.
Увидел цель, которую сервер ещё не засчитал, - зовёт сюда, и стоп переезжает
сразу, а не через обход.

Закрытая вкладка ничего не ломает: обход идёт своим чередом и без просьб.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from backend.deps import get_current_student
from core.models import Student

router = APIRouter(prefix="/api/trading", tags=["trading"])


@router.post("/nudge")
async def nudge(request: Request, student: Student = Depends(get_current_student)):
    """Проверить сделки этого ученика сейчас.

    Чаще раза в пару секунд на ученика не проверяет: просят все его открытые
    вкладки, и это ограничение держит само сопровождение.
    """
    watcher = getattr(request.app.state, "position_watcher", None)
    if watcher is None:
        return {"checked": False}
    return {"checked": await watcher.check_student(student.id)}
