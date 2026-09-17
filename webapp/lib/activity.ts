"use client";

// Тепло торговли: в какие дни сделок было много, в какие ни одной.
//
// Цифры за месяц говорят, чем месяц кончился, но молчат о том, как он шёл.
// А идёт он неровно: три дня подряд по десять сделок, потом неделя тишины,
// потом один день с двумя. Это и есть режим работы трейдера, и увидеть его
// можно только картой, где день - клетка, а насыщенность - число сделок.
//
// Клетки считаются по местному времени: «мой вторник» - это мой вторник, а не
// день гринвичского меридиана.

import type { JournalRow } from "@/components/scalping/JournalTable";

/** Сколько дней показываем: примерно тринадцать недель, как в полке месяцев. */
export const HEAT_DAYS = 91;

export interface HeatDay {
  /** Ключ дня, `2026-09-17`: по нему клетку и находят. */
  key: string;
  /** Полночь этого дня по местному времени. */
  at: Date;
  trades: number;
  pnl: number;
}

/** Ключ дня по местному времени. */
export function dayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** Когда сделка случилась. Ноль - времени нет. */
function timeOf(row: JournalRow): number {
  const at = row.closed_at ?? row.opened_at;
  if (!at) return 0;
  const when = new Date(at).getTime();
  return Number.isNaN(when) ? 0 : when;
}

/**
 * Клетки карты: подряд идущие дни, от самого раннего к сегодняшнему.
 *
 * Карта начинается с понедельника - иначе столбцы перестают быть неделями, и
 * глаз не может сравнить вторник с вторником.
 */
export function heatDays(
  rows: readonly JournalRow[],
  days: number = HEAT_DAYS,
  now: Date = new Date(),
): HeatDay[] {
  const counts = new Map<string, { trades: number; pnl: number }>();
  for (const row of rows) {
    const when = timeOf(row);
    if (when === 0) continue;
    const key = dayKey(new Date(when));
    const was = counts.get(key) ?? { trades: 0, pnl: 0 };
    counts.set(key, { trades: was.trades + 1, pnl: was.pnl + row.pnl });
  }

  const last = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const first = new Date(last);
  first.setDate(first.getDate() - (days - 1));
  // К понедельнику назад: столбец карты - это неделя, а не случайная семёрка.
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));

  const out: HeatDay[] = [];
  for (let at = new Date(first); at <= last; at.setDate(at.getDate() + 1)) {
    const key = dayKey(at);
    const one = counts.get(key);
    out.push({ key, at: new Date(at), trades: one?.trades ?? 0, pnl: one?.pnl ?? 0 });
  }
  return out;
}

/**
 * Насыщенность клетки, 0..4.
 *
 * Уровни считаются от самого плотного дня на карте, а не от выдуманного
 * порога: у скальпера двадцать сделок в день - будни, у свингера три - много.
 * Один день без сделок остаётся пустым всегда: ноль - это ноль, и подкрашивать
 * его нельзя, иначе карта врёт о работе, которой не было.
 */
export function heatLevel(trades: number, busiest: number): number {
  if (trades <= 0) return 0;
  if (busiest <= 1) return 4;
  const share = trades / busiest;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  if (share <= 0.75) return 3;
  return 4;
}

/** Самый плотный день карты: от него и считается насыщенность. */
export function busiestDay(cells: readonly HeatDay[]): number {
  return cells.reduce((top, one) => Math.max(top, one.trades), 0);
}
