// Честные цифры недели: то, что видно из журнала, и ничего сверх.
//
// Под планом недели стоит строка итогов. Она нужна, чтобы план не остался
// обещанием: написал в понедельник «не больше пяти сделок в день, вход только
// по сессии» - к пятнице видно, сколько раз это выдержано.
//
// Правило у этих цифр одно: не додумывать. Дисциплина считается только по
// сделкам, которые трейдер сам отметил в карточке позиции. Неотмеченная сделка
// не считается ни хорошей, ни плохой - её просто ещё не разбирали, и
// показывать её в проценте дисциплины значит врать в свою пользу или против
// себя. Поэтому у отметок своя доля - `marked` из `trades`.
//
// Процент прибыли считается к вложенной марже, а не к счёту: счёта эта часть
// терминала не знает, а называть процентом к счёту то, что им не является, -
// самый простой способ обмануть себя на разборе.

import type { JournalRow } from "@/components/scalping/JournalTable";
import { isoWeek } from "./weekPlan";

export interface WeekStats {
  /** Закрытых сделок за неделю. Идущие не в счёт: итога у них ещё нет. */
  trades: number;
  /** Из них разобрано - то есть отмечено «по плану» или «нарушение». */
  marked: number;
  /** Отмечено «по плану». */
  planned: number;
  /** Отмечено «нарушение». */
  breaks: number;
  /** Сделок в плюс. */
  wins: number;
  /** Доля прибыльных, 0..1. Пусто - сделок за неделю не было. */
  winrate: number | null;
  /** Итог недели деньгами, за вычетом комиссии. */
  pnl: number;
  /** Вложенная маржа всех сделок недели. */
  margin: number;
  /** Итог в процентах к вложенной марже. Пусто - маржи не было. */
  gain: number | null;
}

/** К какой неделе относится сделка: к той, в которую она закрылась. */
function weekOf(row: JournalRow): string {
  const at = row.closed_at ?? row.opened_at;
  if (!at) return "";
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? "" : isoWeek(when);
}

/**
 * Свести сделки недели в цифры.
 *
 * `week` - номер по ISO, как его пишет `isoWeek`. Строки могут быть за любой
 * период: лишние отсеются сами, и панель разбора не обязана запрашивать ровно
 * неделю.
 */
export function weekStats(rows: readonly JournalRow[], week: string): WeekStats {
  return sumUp(rows.filter((row) => row.closed_at !== null && weekOf(row) === week));
}

/**
 * Свести любой отобранный кусок журнала в те же цифры.
 *
 * Неделя - не единственный способ смотреть: день разбирают вечером, месяц раз
 * в месяц. Считается всё одинаково, меняется только отбор, поэтому подсчёт и
 * живёт отдельно от него.
 */
export function sumUp(mine: readonly JournalRow[]): WeekStats {
  const marked = mine.filter((row) => row.plan_ok === true || row.plan_ok === false);
  const planned = marked.filter((row) => row.plan_ok === true).length;
  const wins = mine.filter((row) => row.pnl > 0).length;
  const pnl = mine.reduce((sum, row) => sum + row.pnl, 0);
  const margin = mine.reduce((sum, row) => sum + (row.margin || 0), 0);

  return {
    trades: mine.length,
    marked: marked.length,
    planned,
    breaks: marked.length - planned,
    wins,
    winrate: mine.length > 0 ? wins / mine.length : null,
    pnl,
    margin,
    gain: margin > 0 ? (pnl / margin) * 100 : null,
  };
}
