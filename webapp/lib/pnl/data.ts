"use client";

// Что попадает на карточку из записи журнала.
//
// Отдельно от рисования: журнал знает про сделку всё, карточке нужно немногое,
// и переводить одно в другое лучше в одном месте - иначе доход посчитают
// по-разному в окне и в ссылке.

import { venueTitle } from "@/lib/exchanges";
import { dict } from "@/lib/i18n";
import type { SharedTrade } from "@/lib/chat/api";
import type { JournalTrade, LiveJournalTrade } from "@/lib/journal";

import { price, stamped, type CardData, type CardSide } from "./card";

/**
 * Доход в процентах - от залога, а не от оборота.
 *
 * Именно так его считают биржи, и трейдер сверяет карточку с их приложением:
 * плечо в двадцать пять раз превращает движение цены на восемь процентов в
 * двести процентов на залог, и меньшая цифра выглядела бы обманом в обратную
 * сторону.
 */
export function roiOf(trade: JournalTrade | LiveJournalTrade): number {
  const margin = Number(trade.margin);
  if (!Number.isFinite(margin) || margin <= 0) return 0;
  return (Number(trade.pnl) / margin) * 100;
}

/** Запись журнала - в карточку. Идущая сделка тоже: у неё свои строки. */
export function cardFromTrade(
  trade: JournalTrade | LiveJournalTrade,
  owner?: string,
): CardData {
  const t = dict().pnlCard;
  const side = trade.side === "long" ? t.long : t.short;
  // Идущую сделку заверяем временем входа: даты закрытия у неё ещё нет, а
  // выдумывать её нельзя.
  const at = trade.closed_at ?? trade.opened_at ?? new Date().toISOString();
  return {
    title: trade.symbol,
    subtitle: `${side}   |   ${trade.leverage}x`,
    side: trade.side,
    roi: roiOf(trade),
    // Итог тот же, что в журнале: после комиссии. Карточка с доходом до неё
    // обещала бы больше, чем пришло на счёт.
    pnl: Number(trade.pnl),
    rows: journalRows(trade, t),
    footer: [t.stamped, stamped(at)],
    at,
    owner: owner || undefined,
    venue: venueTitle(trade.exchange) || undefined,
  };
}

/** Строки карточки из журнала: вход, выход или стоп, и сколько целей взято. */
function journalRows(
  trade: JournalTrade | LiveJournalTrade,
  t: ReturnType<typeof dict>["pnlCard"],
): [string, string][] {
  // У идущей сделки выхода ещё нет - на его месте стоп, тот, что стоит на
  // бирже сейчас, а не тот, с которым сделка задумывалась.
  const live = trade.closed_at === null;
  const now = live
    ? Number((trade as LiveJournalTrade).stop_now ?? trade.stop)
    : Number(trade.stop);
  const safe = breakeven({ side: trade.side, entry: Number(trade.entry), stop: now });
  const rows: [string, string][] = [
    [t.entryPrice, price(Number(trade.entry))],
    live
      ? [stopLabel(t, safe), price(now)]
      : [t.exitPrice, trade.exit_price === null ? "-" : price(Number(trade.exit_price))],
  ];
  if (trade.targets.length > 0) {
    rows.push([t.targetsRow, t.ofTargets(trade.takes_hit, trade.targets.length)]);
  }
  return rows;
}

/**
 * Сделка, показанная в чате, - в карточку.
 *
 * Отдельно от записи журнала: у той есть цена выхода и комиссия, а здесь снимок
 * цифр на момент отправки. Идущая сделка попадает сюда с плавающим результатом,
 * и это честно ровно настолько, насколько честна сама карточка: она заверяет
 * момент, а не итог.
 *
 * Дата - закрытия у закрытой, сообщения у идущей. Заверять идущую сделку
 * временем, которого ещё не было, нельзя.
 */
export function cardFromShared(trade: SharedTrade, at: string, owner?: string): CardData {
  const t = dict().pnlCard;
  const side = trade.side === "long" ? t.long : t.short;
  const floating = Number(trade.pnl ?? 0);
  const margin = Number(trade.margin ?? 0);
  const running = trade.state === "open";
  const locked = trade.locked == null ? null : Number(trade.locked);
  // У идущей сделки крупным - забранное целями, а не плавающее по остатку.
  // Карточка живёт в чужой ленте часами: плавающее к тому времени уже
  // неправда, а взятые деньги взяты.
  const main = running && locked !== null ? locked : floating;

  return {
    title: trade.symbol,
    subtitle: `${side}   |   ${trade.leverage}x`,
    side: trade.side as CardSide,
    roi: margin > 0 ? (main / margin) * 100 : 0,
    pnl: main,
    rows: sharedRows(trade, t),
    footer: [t.stamped, stamped(at)],
    at,
    owner: owner || undefined,
    venue: venueTitle(trade.exchange) || undefined,
  };
}

/**
 * Строки карточки: вход, стоп и - у идущей сделки - взятые цели.
 *
 * Стоп за входом подписан «б/у», а не ценой: цифра сама по себе не говорит,
 * что сделка уже не может кончиться убытком, а это первое, что хотят видеть.
 */
function sharedRows(
  trade: SharedTrade,
  t: ReturnType<typeof dict>["pnlCard"],
): [string, string][] {
  const closed = trade.state === "closed";
  const rows: [string, string][] = [
    [t.entryPrice, price(trade.entry)],
    closed
      ? [t.exitPrice, price(trade.stop)]
      : [stopLabel(t, breakeven(trade)), price(trade.stop)],
  ];
  // Взятые цели - и у закрытой тоже: по ним видно, как сделка шла, а не
  // только чем кончилась. Целей не ставили вовсе - строки нет.
  const targets = trade.targets?.length ?? 0;
  if (targets > 0) {
    rows.push([t.targetsRow, t.ofTargets(trade.takesHit ?? 0, targets)]);
  }
  return rows;
}

/**
 * Подпись строки стопа: «Стоп» или «Стоп б/у».
 *
 * Метка стоит у слова, а не у числа: в колонке значений живут одни цены, и
 * приписка перед ценой ломала их ряд.
 */
function stopLabel(t: ReturnType<typeof dict>["pnlCard"], safe: boolean): string {
  return safe ? `${t.stopPrice} ${t.stopBreakeven}` : t.stopPrice;
}

/** Стоп уже за входом: сделка не может кончиться убытком. */
export function breakeven(trade: {
  side: string;
  entry: number;
  stop: number;
}): boolean {
  if (!(trade.entry > 0) || !(trade.stop > 0)) return false;
  return trade.side === "long" ? trade.stop >= trade.entry : trade.stop <= trade.entry;
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
