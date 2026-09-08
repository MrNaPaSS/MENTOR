"use client";

// Сделки терминала в браузере.
//
// Уйти со страницы и вернуться - обычное дело, а позиция на рынке от этого не
// закрывается, значит и разметка её пропадать не должна.
//
// Читает отсюда не только терминал: за сделками следит и оболочка кабинета,
// чтобы сообщить о входе или закрытии, в каком бы разделе трейдер ни был.
// Разбор хранилища поэтому один на всех - две копии рано или поздно разойдутся
// в мелочи, и одна из них начнёт терять сделки.

import type { ActiveTrade } from "@/lib/trade/position";

/** Ключ прежней версии: там лежала одна сделка, а не список. */
const TRADE_KEY = "nmnh.scalping.trade";
export const TRADES_KEY = "nmnh.scalping.trades";

export function readTrades(): ActiveTrade[] {
  try {
    const raw = localStorage.getItem(TRADES_KEY);
    if (raw) {
      const list = JSON.parse(raw) as ActiveTrade[];
      return Array.isArray(list) ? list.filter((t) => t && t.status !== "closed") : [];
    }
    // Переезд со старого ключа: у трейдера могла остаться идущая сделка,
    // записанная прежней версией, и терять её из-за обновления нельзя.
    const single = localStorage.getItem(TRADE_KEY);
    const trade = single ? (JSON.parse(single) as ActiveTrade) : null;
    return trade && trade.status !== "closed" ? [trade] : [];
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
    return [];
  }
}

/** Записать живые сделки. Пустой список стирает ключ, а не хранит пустоту. */
export function writeTrades(trades: ActiveTrade[]): void {
  try {
    const alive = trades.filter((t) => t.status !== "closed");
    if (alive.length > 0) localStorage.setItem(TRADES_KEY, JSON.stringify(alive));
    else localStorage.removeItem(TRADES_KEY);
    // Старый ключ больше не читается никем, кроме переезда, - чистим, чтобы
    // он не воскресил закрытую сделку.
    localStorage.removeItem(TRADE_KEY);
  } catch {
    // Не сохранилось - сделки всё равно на экране.
  }
}
