// Разбор недели: что видно из журнала, если посмотреть на неделю целиком.
//
// Отдельные сделки трейдер разбирает по карточкам, и там всё на месте: вход,
// стоп, снимки, отметка «по плану». Но неделя - это не сумма карточек. Привычку
// видно только сверху: где сессия кормит, а где съедает, какое правило ломается
// чаще прочих, и что происходит с торговлей сразу после убытка.
//
// Здесь только факты и собственные отметки трейдера. Советов и оценок нет
// намеренно: разбор, который сам ставит диагноз, читают как гороскоп, а не как
// свою статистику. Вывод делает человек.

import type { JournalRow } from "@/components/scalping/JournalTable";
import { sessionOf } from "@/components/scalping/PositionCard";
import { weekStats, type WeekStats } from "./weekStats";
import { isoWeek } from "./weekPlan";

/** Сколько минут после убытка считаются «сразу после». */
export const REVENGE_MINUTES = 15;

export type SessionName = ReturnType<typeof sessionOf>;

export interface SessionLine {
  name: SessionName;
  trades: number;
  wins: number;
  pnl: number;
}

export interface WeekReview {
  week: string;
  stats: WeekStats;
  /** Лучшая и худшая позиции недели. Пусто - сделок не было. */
  best: JournalRow | null;
  worst: JournalRow | null;
  /** Отмеченные нарушения по кодам, чаще встречающиеся выше. */
  mistakes: { code: string; count: number }[];
  /** Сессии, в которых была торговля. Пустые не показываем. */
  sessions: SessionLine[];
  /** Что было открыто в четверть часа после убыточной сделки. */
  revenge: { trades: number; pnl: number; minutes: number };
}

function at(row: JournalRow): number {
  const when = row.closed_at ?? row.opened_at;
  const stamp = when ? new Date(when).getTime() : NaN;
  return Number.isNaN(stamp) ? 0 : stamp;
}

/** Сделки недели, закрытые, по порядку закрытия. */
function weekRows(rows: readonly JournalRow[], week: string): JournalRow[] {
  return rows
    .filter((row) => {
      const when = row.closed_at;
      if (!when) return false;
      const stamp = new Date(when);
      return !Number.isNaN(stamp.getTime()) && isoWeek(stamp) === week;
    })
    .sort((a, b) => at(a) - at(b));
}

/**
 * Свести неделю в разбор.
 *
 * Строки могут быть за любой период - лишние отсеются. Результат - только
 * цифры и коды: тексты подставляет тот, кто рисует, на языке интерфейса.
 */
export function weekReview(rows: readonly JournalRow[], week: string): WeekReview {
  const mine = weekRows(rows, week);

  const best = mine.reduce<JournalRow | null>(
    (top, row) => (top === null || row.pnl > top.pnl ? row : top),
    null,
  );
  const worst = mine.reduce<JournalRow | null>(
    (low, row) => (low === null || row.pnl < low.pnl ? row : low),
    null,
  );

  // Нарушения считаем по отметкам, а не по догадкам: код попал в список
  // потому, что трейдер сам его поставил.
  const tally = new Map<string, number>();
  for (const row of mine) {
    for (const code of row.mistakes ?? []) {
      tally.set(code, (tally.get(code) ?? 0) + 1);
    }
  }
  const mistakes = [...tally.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const bySession = new Map<SessionName, SessionLine>();
  for (const row of mine) {
    const name = sessionOf(row.opened_at);
    const line = bySession.get(name) ?? { name, trades: 0, wins: 0, pnl: 0 };
    bySession.set(name, {
      name,
      trades: line.trades + 1,
      wins: line.wins + (row.pnl > 0 ? 1 : 0),
      pnl: line.pnl + row.pnl,
    });
  }
  const sessions = [...bySession.values()].sort((a, b) => b.trades - a.trades);

  // Поведение после убытка: сделка, открытая в четверть часа после закрытия
  // минусовой, - это чаще всего отыгрыш, а не замысел. Считаем их отдельно,
  // чтобы было видно, во что они обходятся.
  const window = REVENGE_MINUTES * 60 * 1000;
  let after = 0;
  let afterPnl = 0;
  for (const row of mine) {
    const born = row.opened_at ? new Date(row.opened_at).getTime() : NaN;
    if (Number.isNaN(born)) continue;
    const hurt = mine.some((other) => {
      if (other === row || other.pnl >= 0 || !other.closed_at) return false;
      const done = new Date(other.closed_at).getTime();
      return !Number.isNaN(done) && born > done && born - done <= window;
    });
    if (hurt) {
      after += 1;
      afterPnl += row.pnl;
    }
  }

  return {
    week,
    stats: weekStats(rows, week),
    best,
    worst,
    mistakes,
    sessions,
    revenge: { trades: after, pnl: afterPnl, minutes: REVENGE_MINUTES },
  };
}
