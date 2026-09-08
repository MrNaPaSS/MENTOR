"use client";

// Итог за срок: день, неделя, месяц.
//
// Складывается по тем же дням календаря, которые ученик видит на экране, и по
// тому же правилу - иначе карточка спорила бы с полосой «итог месяца» под
// календарём, а это одно и то же число.

import { dict } from "@/lib/i18n";
import type { CalendarDay } from "@/lib/api";

import type { Period } from "./data";

export type Span = "day" | "week" | "month";



/**
 * Опорная дата на месте.
 *
 * Кнопки сроков стоят на странице с первого кадра, а календарь приезжает
 * запросом: до ответа опорной даты нет вовсе. Неделя считала из неё границы
 * через Date, получала Invalid Date, и toISOString роняла всю аналитику
 * клиентским исключением - пустой чёрный экран вместо страницы.
 */
function dated(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

/** Дата календаря в числах. Разбором строки, а не через Date: пояс тут лишний. */
function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/**
 * Понедельник недели, в которую попала дата, и её воскресенье.
 *
 * Неделя календарная, а не «последние семь дней»: сетка над ней размечена с
 * понедельника по воскресенье, и срок должен совпадать с тем, что обведено
 * глазами.
 */
function week(iso: string): [string, string] {
  const { y, m, d } = parts(iso);
  const at = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: воскресенье это 0, а неделя у нас начинается понедельником.
  const shift = (at.getUTCDay() + 6) % 7;
  const from = new Date(at);
  from.setUTCDate(at.getUTCDate() - shift);
  const to = new Date(from);
  to.setUTCDate(from.getUTCDate() + 6);
  const iso10 = (x: Date) => x.toISOString().slice(0, 10);
  return [iso10(from), iso10(to)];
}

/** Дни срока - те, что вообще есть в календаре. */
export function daysOf(all: CalendarDay[], span: Span, anchor: string): CalendarDay[] {
  if (!dated(anchor)) return [];
  if (span === "day") return all.filter((d) => d.date === anchor);
  if (span === "month") return all;
  const [from, to] = week(anchor);
  return all.filter((d) => d.date >= from && d.date <= to);
}

/**
 * Сводка за срок. `null` - складывать нечего.
 *
 * Пустая карточка хуже отсутствующей: «+0,00% за 0 сделок» выглядит как
 * результат, хотя означает, что данных нет.
 */
export function periodOf(all: CalendarDay[], span: Span, anchor: string): Period | null {
  if (!dated(anchor)) return null;
  const days = daysOf(all, span, anchor);
  // Тот же отбор, что и у полосы итогов под календарём.
  const counted = days.filter((d) => d.pnl_pct !== null);
  if (!counted.length) return null;

  const trades = counted.reduce((s, d) => s + (d.journal_trades ?? 0), 0);
  if (!trades) return null;

  const roi = counted.reduce((s, d) => s + (d.pnl_pct ?? 0), 0);
  const pnl = counted.reduce((s, d) => s + (d.journal_pnl ?? 0), 0);
  const tradeDays = counted.filter((d) => (d.journal_trades ?? 0) > 0);
  const winDays = tradeDays.filter((d) => (d.pnl_pct ?? 0) > 0).length;

  const from = counted[0].date;
  const to = counted[counted.length - 1].date;
  const at = parts(anchor);
  const t = dict().pnlCard;
  const MONTHS_OF = t.monthsGenitive;
  const MONTHS = t.monthsNominative;

  const title =
    span === "day"
      ? `${at.d} ${MONTHS_OF[at.m - 1]}`
      : span === "month"
        ? `${MONTHS[at.m - 1]} ${at.y}`
        : (() => {
            const a = parts(from);
            const b = parts(to);
            return a.m === b.m
              ? `${a.d} - ${b.d} ${MONTHS_OF[b.m - 1]}`
              : `${a.d} ${MONTHS_OF[a.m - 1]} - ${b.d} ${MONTHS_OF[b.m - 1]}`;
          })();

  const label =
    span === "day" ? t.dayResult : span === "week" ? t.weekResult : t.monthResult;

  return { title, label, roi, pnl, trades, winDays, tradeDays: tradeDays.length, from, to };
}
