"""Магазин NMNH — покупка товаров за монеты.

Студент тратит монеты → создаётся заказ ``pending`` и списываются монеты
(через отрицательный ``CoinTransaction``). Ментор вручную выполняет (``fulfilled``)
или отклоняет (``rejected`` + возврат монет). Каталог управляется ментором (CRUD).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from core.models import CoinTransaction, ShopItem, ShopOrder, Student
from backend.deps import get_session, get_current_student, get_current_mentor
from backend.schemas import (
    ShopItemOut, ShopItemIn, ShopItemPatch,
    ShopOrderOut, ShopOrderCreate, ShopOrderResolve,
)

router = APIRouter(prefix="/api/shop", tags=["shop"])
admin_router = APIRouter(
    prefix="/api/shop/admin", tags=["shop-admin"],
    dependencies=[Depends(get_current_mentor)],
)


def _item_out(it: ShopItem) -> ShopItemOut:
    return ShopItemOut(
        id=it.id, title=it.title, description=it.description, price=it.price,
        category=it.category, section=it.section, icon=it.icon, link_url=it.link_url,
        is_active=it.is_active, sort_order=it.sort_order,
    )


def _order_out(o: ShopOrder, *, with_student: bool = False) -> ShopOrderOut:
    out = ShopOrderOut(
        id=o.id, item_id=o.item_id, item_title=o.item_title, price=o.price,
        status=o.status, contact=o.contact, mentor_note=o.mentor_note,
        created_at=o.created_at.isoformat(),
        resolved_at=o.resolved_at.isoformat() if o.resolved_at else None,
    )
    if with_student and o.student is not None:
        out.student_id = o.student.id
        out.student_username = o.student.username
        out.student_uid = o.student.weex_uid
    return out


# ─────────────────────── Студент ───────────────────────

@router.get("/items", response_model=list[ShopItemOut])
def list_items(session=Depends(get_session)):
    """Активные товары магазина (для ученика)."""
    rows = session.execute(
        select(ShopItem).where(ShopItem.is_active.is_(True))
        .order_by(ShopItem.sort_order, ShopItem.id)
    ).scalars().all()
    return [_item_out(it) for it in rows]


@router.get("/orders", response_model=list[ShopOrderOut])
def my_orders(student: Student = Depends(get_current_student), session=Depends(get_session)):
    """История заказов текущего ученика."""
    rows = session.execute(
        select(ShopOrder).where(ShopOrder.student_id == student.id)
        .order_by(ShopOrder.created_at.desc())
    ).scalars().all()
    return [_order_out(o) for o in rows]


@router.post("/orders", response_model=ShopOrderOut)
def create_order(
    body: ShopOrderCreate,
    student: Student = Depends(get_current_student),
    session=Depends(get_session),
):
    """Купить товар: проверить баланс, списать монеты, создать заказ ``pending``."""
    item = session.get(ShopItem, body.item_id)
    if item is None or not item.is_active:
        raise HTTPException(404, "Товар не найден или снят с продажи")
    if item.price <= 0:
        raise HTTPException(400, "Этот товар нельзя купить за монеты")

    fresh = session.get(Student, student.id)
    if (fresh.coins or 0) < item.price:
        raise HTTPException(400, "Недостаточно монет NMNH")

    order = ShopOrder(
        student_id=fresh.id,
        item_id=item.id,
        item_title=item.title,
        price=item.price,
        status="pending",
        contact=body.contact.strip()[:255],
    )
    session.add(order)
    session.flush()  # получить order.id для ref

    # Списание монет — отрицательная транзакция
    session.add(CoinTransaction(
        student_id=fresh.id,
        amount=-item.price,
        reason="purchase",
        ref=f"order_{order.id}",
    ))
    fresh.coins = (fresh.coins or 0) - item.price

    session.commit()
    session.refresh(order)
    return _order_out(order)


# ─────────────────────── Ментор: каталог ───────────────────────

@admin_router.get("/items", response_model=list[ShopItemOut])
def admin_list_items(session=Depends(get_session)):
    """Все товары (включая скрытые)."""
    rows = session.execute(
        select(ShopItem).order_by(ShopItem.sort_order, ShopItem.id)
    ).scalars().all()
    return [_item_out(it) for it in rows]


@admin_router.post("/items", response_model=ShopItemOut)
def admin_create_item(body: ShopItemIn, session=Depends(get_session)):
    item = ShopItem(
        title=body.title, description=body.description, price=body.price,
        category=body.category, section=body.section, icon=body.icon,
        link_url=body.link_url, is_active=body.is_active, sort_order=body.sort_order,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return _item_out(item)


@admin_router.patch("/items/{item_id}", response_model=ShopItemOut)
def admin_update_item(item_id: int, body: ShopItemPatch, session=Depends(get_session)):
    item = session.get(ShopItem, item_id)
    if item is None:
        raise HTTPException(404, "Товар не найден")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    session.commit()
    session.refresh(item)
    return _item_out(item)


@admin_router.delete("/items/{item_id}")
def admin_delete_item(item_id: int, session=Depends(get_session)):
    item = session.get(ShopItem, item_id)
    if item is None:
        raise HTTPException(404, "Товар не найден")
    session.delete(item)
    session.commit()
    return {"ok": True}


# ─────────────────────── Ментор: заказы ───────────────────────

@admin_router.get("/orders", response_model=list[ShopOrderOut])
def admin_list_orders(status: str | None = None, session=Depends(get_session)):
    """Все заказы с данными ученика. Фильтр по статусу (pending|fulfilled|rejected)."""
    stmt = select(ShopOrder).order_by(ShopOrder.created_at.desc())
    if status:
        stmt = stmt.where(ShopOrder.status == status)
    rows = session.execute(stmt).scalars().all()
    return [_order_out(o, with_student=True) for o in rows]


@admin_router.post("/orders/{order_id}/fulfill", response_model=ShopOrderOut)
def admin_fulfill_order(order_id: int, body: ShopOrderResolve, session=Depends(get_session)):
    """Отметить заказ выполненным (монеты уже списаны при покупке)."""
    order = session.get(ShopOrder, order_id)
    if order is None:
        raise HTTPException(404, "Заказ не найден")
    if order.status != "pending":
        raise HTTPException(400, "Заказ уже обработан")
    order.status = "fulfilled"
    order.mentor_note = body.mentor_note.strip()[:255]
    order.resolved_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(order)
    return _order_out(order, with_student=True)


@admin_router.post("/orders/{order_id}/reject", response_model=ShopOrderOut)
def admin_reject_order(order_id: int, body: ShopOrderResolve, session=Depends(get_session)):
    """Отклонить заказ и вернуть монеты ученику."""
    order = session.get(ShopOrder, order_id)
    if order is None:
        raise HTTPException(404, "Заказ не найден")
    if order.status != "pending":
        raise HTTPException(400, "Заказ уже обработан")

    student = session.get(Student, order.student_id)
    if student is not None:
        session.add(CoinTransaction(
            student_id=student.id,
            amount=order.price,
            reason="refund",
            ref=f"order_{order.id}_refund",
        ))
        student.coins = (student.coins or 0) + order.price

    order.status = "rejected"
    order.mentor_note = body.mentor_note.strip()[:255]
    order.resolved_at = datetime.now(timezone.utc)
    session.commit()
    session.refresh(order)
    return _order_out(order, with_student=True)
