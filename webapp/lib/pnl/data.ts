"use client";

// Что попадает на карточку из записи журнала.
//
// Отдельно от рисования: журнал знает про сделку всё, карточке нужно немногое,
// и переводить одно в другое лучше в одном месте - иначе доход посчитают
// по-разному в окне и в ссылке.

import { dict } from "@/lib/i18n";
import type { JournalTrade } from "@/lib/journal";

import { price, stamped, type CardData, type CardSide } from "./card";

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
  const t = dict().pnlCard;
  const side = trade.side === "long" ? t.long : t.short;
  return {
    title: trade.symbol,
    subtitle: `${side}   |   ${trade.leverage}x`,
    side: trade.side,
    roi: roiOf(trade),
    // Итог тот же, что в журнале: после комиссии. Карточка с доходом до неё
    // обещала бы больше, чем пришло на счёт.
    pnl: Number(trade.pnl),
    rows: [
      [t.entryPrice, price(Number(trade.entry))],
      [t.exitPrice, trade.exit_price === null ? "-" : price(Number(trade.exit_price))],
    ],
    footer: [t.stamped, stamped(trade.closed_at)],
    at: trade.closed_at,
    owner: owner || undefined,
  };
}

/** Итог за срок: день, неделя, месяц. */
export type Period = {
  /** Крупная строка: «8 сентября», «1 - 7 сентября», «Сентябрь 2026». */
  title: string;
  /** Строка под ней: «Итог дня» и так далее. */
  label: string;
  /** Доход за срок в процентах от депозита. */
  roi: number;
  /** Доход за срок в USDT. */
  pnl: number;
  /** Сколько сделок закрыто за срок. */
  trades: number;
  /** Сколько дней срока закончились в плюс и сколько всего торговали. */
  winDays: number;
  tradeDays: number;
  /** Границы срока, чтобы подписать карточку. */
  from: string;
  to: string;
};

/** Множественное число по-русски: 1 сделка, 2 сделки, 5 сделок. */

function dotted(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Итог за срок - в карточку.
 *
 * Заготовку выбирает знак итога, а не сторона сделки: у срока стороны нет, а
 * бланки нарисованы под неё - на медвежьем листе прибыльный месяц читался бы
 * наоборот. Прибыльный срок идёт на бычьи бланки, убыточный на медвежьи.
 */
export function cardFromPeriod(period: Period, owner?: string): CardData {
  const t = dict().pnlCard;
  const side: CardSide = period.pnl >= 0 ? "long" : "short";
  return {
    title: period.title,
    subtitle: period.label,
    side,
    roi: period.roi,
    pnl: period.pnl,
    rows: [
      [t.trades, `${period.trades} ${t.tradeWord(period.trades)}`],
      [
        t.winDays,
        period.tradeDays > 0 ? t.ofDays(period.winDays, period.tradeDays) : "-",
      ],
    ],
    footer: [
      period.from === period.to ? t.date : t.period,
      period.from === period.to ? dotted(period.to) : `${dotted(period.from)} - ${dotted(period.to)}`,
    ],
    at: `${period.to}T12:00:00`,
    owner: owner || undefined,
  };
}
