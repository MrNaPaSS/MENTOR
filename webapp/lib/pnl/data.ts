"use client";

// Что попадает на карточку из записи журнала.
//
// Отдельно от рисования: журнал знает про сделку всё, карточке нужно немногое,
// и переводить одно в другое лучше в одном месте - иначе доход посчитают
// по-разному в окне и в ссылке.

import type { JournalTrade } from "@/lib/journal";

import type { CardData } from "./card";

/**
 * Доход в процентах - от залога, а не от оборота.
 *
 * Именно так его считают биржи, и трейдер сверяет карточку с их приложением:
 * плечо в двадцать пять раз превращает движение цены на восемь процентов в
 * двести процентов на залог, и меньшая цифра выглядела бы обманом в обратную
 * сторону.
 */
export function roiOf(trade: JournalTrade): number {
  const margin = Number(trade.margin);
  if (!Number.isFinite(margin) || margin <= 0) return 0;
  return (Number(trade.pnl) / margin) * 100;
}

/** Запись журнала - в карточку. */
export function cardFromTrade(trade: JournalTrade, owner?: string): CardData {
  return {
    symbol: trade.symbol,
    side: trade.side,
    leverage: trade.leverage,
    roi: roiOf(trade),
    // Итог тот же, что в журнале: после комиссии. Карточка с доходом до неё
    // обещала бы больше, чем пришло на счёт.
    pnl: Number(trade.pnl),
    entry: Number(trade.entry),
    exit: trade.exit_price === null ? null : Number(trade.exit_price),
    at: trade.closed_at,
    owner: owner || undefined,
  };
}
