"""Рынок и калькулятор (ТЗ §15.8)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from core.calculator import calculate, Mode, Direction
from backend.deps import get_weex, get_settings
from backend.schemas import CalcRequest, CalcResponse, PriceResponse, TakeProfitOut

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/price/{symbol}", response_model=PriceResponse)
async def get_price(symbol: str, weex=Depends(get_weex)):
    price = await weex.get_price(symbol.upper())
    return PriceResponse(symbol=symbol.upper(), price=price)


@router.post("/calculate", response_model=CalcResponse)
async def calc(req: CalcRequest, weex=Depends(get_weex), settings=Depends(get_settings)):
    try:
        min_order = await weex.get_min_order_usd(
            req.entry_price and "BTCUSDT" or "BTCUSDT"  # символ не нужен для расчёта
        )
        result = calculate(
            mode=Mode(req.mode),
            balance=req.balance,
            entry_price=req.entry_price,
            direction=Direction(req.direction),
            leverage=req.leverage,
            settings=settings,
            sl_price=req.sl_price,
            tp_prices=req.tp_prices,
            min_order_usd=min_order,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, f"Некорректные параметры: {exc}")

    return CalcResponse(
        mode=result.mode.value,
        direction=result.direction.value,
        balance=result.balance,
        leverage=result.leverage,
        entry_price=result.entry_price,
        margin_usd=result.margin_usd,
        position_size=result.position_size,
        sl_percent=result.sl_percent,
        sl_price=result.sl_price,
        risk_usd=result.risk_usd,
        risk_percent_of_balance=result.risk_percent_of_balance,
        margin_type=result.margin_type,
        take_profits=[
            TakeProfitOut(
                index=tp.index, percent=tp.percent, price=tp.price,
                profit_usd=tp.profit_usd, rr=tp.rr,
            )
            for tp in result.take_profits
        ],
        warnings=result.warnings,
        status=result.status,
    )
