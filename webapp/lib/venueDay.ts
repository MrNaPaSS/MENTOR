// Клетка календаря в разрезе одной биржи.
//
// Общие числа дня сервер отдаёт нетронутыми: на них стоят вехи, достижения и
// уровень, а они считаются по всем биржам сразу - это про ученика академии, а
// не про его счёт. Здесь из разреза собирается копия клетки для календаря:
// суммы двух счетов в одной клетке не сходятся ни с одним из них.

import type { CalendarDay } from "./api";

/**
 * Тот же день глазами одной биржи. День без её сделок честно пустой.
 *
 * Оборот с биржи в копию не переносится: партнёрская цифра приходит на весь
 * счёт целиком и по биржам не делится. В разрезе остаётся оборот журнала - то,
 * что терминал провёл сам и знает поимённо.
 */
export function dayOfVenue(day: CalendarDay, venue: string): CalendarDay {
  const row = day.journal_by_exchange?.find((one) => one.exchange === venue);
  return {
    ...day,
    pnl_pct: row?.pnl_pct ?? 0,
    journal_pnl: row?.pnl ?? 0,
    journal_volume: row?.volume ?? 0,
    journal_trades: row?.trades ?? 0,
    trade_volume: 0,
  };
}

/** Сколько сделок месяца пришлось на биржу: подсказка у её кнопки. */
export function monthTradesOf(days: readonly CalendarDay[], venue: string): number {
  return days.reduce(
    (sum, day) =>
      sum + (day.journal_by_exchange?.find((one) => one.exchange === venue)?.trades ?? 0),
    0,
  );
}
