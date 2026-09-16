"use client";

// Календарь прибыли: месяц по дням.
//
// По списку сделок видно, что было в конкретной сделке, по календарю - что
// было с дисциплиной: один красный день на месяц и десять подряд выглядят
// одинаково в сумме и совершенно по-разному на сетке.
//
// Поэтому клетка показывает не только деньги. Число месяца стоит в каждой -
// без него сетка превращается в набор сумм, к которым нечего привязать, а
// трейдер ищет глазами «что было в понедельник», а не «где тут плюс тысяча».
// Дни без сделок остаются пустыми, но видимыми: пропуск - тоже часть картины.

import { useT, useIntlLocale } from "@/lib/i18n";
import { money, tone } from "@/lib/journalFormat";
import type { JournalDay } from "@/lib/journal";

/** Клетка сетки: день месяца или пустое место соседнего. */
type Cell =
  | { kind: "own"; day: number; date: string; entry?: JournalDay }
  | { kind: "other"; day: number };

/**
 * Сетка месяца: понедельник первым, соседние дни по краям.
 *
 * Хвосты чужих месяцев не выкидываем, а гасим: прямоугольная сетка держит
 * форму при любом месяце, а рваная последняя неделя каждый раз выглядит
 * обрывом загрузки.
 */
function monthCells(year: number, month: number, days: readonly JournalDay[]): Cell[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = new Date(Date.UTC(year, month - 1, 1));
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const before = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  // getUTCDay(): воскресенье - ноль, а неделя у нас начинается с понедельника.
  const lead = (first.getUTCDay() + 6) % 7;

  const cells: Cell[] = [];
  for (let i = lead; i > 0; i -= 1) cells.push({ kind: "other", day: before - i + 1 });
  for (let day = 1; day <= total; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ kind: "own", day, date, entry: byDate.get(date) });
  }
  // До полной недели: сетка всегда прямоугольная.
  for (let day = 1; cells.length % 7 !== 0; day += 1) cells.push({ kind: "other", day });
  return cells;
}

export interface JournalCalendarProps {
  year: number;
  month: number;
  days: readonly JournalDay[];
  /** Итог месяца - с сервера, а не сумма клеток: считает его он. */
  total: number;
  /** Листнуть месяц: -1 назад, +1 вперёд. */
  onShift: (delta: number) => void;
  /** Вернуться в текущий месяц. */
  onToday: () => void;
  /** Выбранный день - его сделки показывает список. Null - весь период. */
  picked: string | null;
  onPickDay: (date: string | null) => void;
}

export default function JournalCalendar({
  year,
  month,
  days,
  total,
  onShift,
  onToday,
  picked,
  onPickDay,
}: JournalCalendarProps) {
  const t = useT();
  const numbers = useIntlLocale();

  const cells = monthCells(year, month, days);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const current = now.getFullYear() === year && now.getMonth() + 1 === month;
  const ahead = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);

  // Чем месяц кончился, кроме суммы: торговых дней, из них в плюс, средний
  // день и лучший. Одна сумма за месяц не отличает десять ровных дней от
  // одного удачного и девяти пустых.
  const traded = days.filter((d) => d.trades > 0);
  const wins = traded.filter((d) => d.pnl > 0).length;
  const average = traded.length > 0 ? total / traded.length : 0;
  const best = traded.reduce<JournalDay | null>(
    (top, day) => (top === null || day.pnl > top.pnl ? day : top),
    null,
  );

  // Название месяца словами: «09.2026» читается как номер счёта, а не как
  // сентябрь. Год рядом - листать можно далеко. Месяц и год складываем сами:
  // русская локаль к паре «месяц + год» приписывает «г.», а в строке с итогом
  // за месяц это лишний хвост.
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(numbers, {
    month: "long",
    timeZone: "UTC",
  });
  const title = `${monthName} ${year}`;

  return (
    <div className="rounded border border-[var(--pane-border)] p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          onClick={() => onShift(-1)}
          title={t.journal.prevMonth}
          aria-label={t.journal.prevMonth}
          className="rounded px-1.5 py-0.5 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)]"
        >
          ←
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] font-semibold capitalize text-[var(--pane-text)]">
            {title}
          </span>
          <span className={`font-mono text-[11px] tabular-nums ${tone(total)}`}>
            {money(total)} $
          </span>
          {/* Кнопка возврата - только когда ушли из текущего месяца: в нём она
              ничего бы не делала и только сбивала бы с толку. */}
          {!current && (
            <button
              onClick={onToday}
              className="rounded px-1.5 py-0.5 text-[10px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)] hover:text-[var(--pane-accent)]"
            >
              {t.journal.today}
            </button>
          )}
        </div>

        {/* Вперёд - не дальше текущего месяца: в будущем сделок не бывает, а
            пустая сетка там читается как потерянные записи. */}
        <button
          onClick={() => onShift(1)}
          disabled={ahead}
          title={t.journal.nextMonth}
          aria-label={t.journal.nextMonth}
          className="rounded px-1.5 py-0.5 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)] disabled:pointer-events-none disabled:opacity-30"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {t.journal.weekdays.map((day, i) => (
          <span
            key={day}
            className={`pb-0.5 text-center text-[10px] text-[var(--pane-muted)] ${
              i >= 5 ? "opacity-60" : ""
            }`}
          >
            {day}
          </span>
        ))}

        {cells.map((cell, i) => {
          if (cell.kind === "other") {
            return (
              <div
                key={i}
                aria-hidden
                className="rounded px-1.5 py-1 text-[9px] leading-none text-[var(--pane-muted)] opacity-25"
              >
                {cell.day}
              </div>
            );
          }

          const entry = cell.entry;
          const active = entry !== undefined && entry.trades > 0;
          const up = active && entry.pnl >= 0;
          const chosen = cell.date === picked;
          return (
            /* День с сделками - кнопка: нажатие оставляет в списке справа
               только его сделки. По календарю ищут «что случилось в тот
               вторник», и добираться до ответа прокруткой списка человек не
               должен. Пустой день нажимать незачем. */
            <button
              key={i}
              type="button"
              disabled={!active}
              onClick={() => onPickDay(chosen ? null : cell.date)}
              title={active ? t.journal.cellTitle(entry.trades, money(entry.pnl)) : t.journal.noTrades}
              className={`flex min-h-[2.6rem] flex-col justify-between rounded px-1.5 py-1 text-left transition-colors duration-150 ease-out ${
                active
                  ? up
                    ? "bg-[var(--pane-up-soft)] hover:bg-[var(--pane-up-strong)]"
                    : "bg-[var(--pane-down-soft)] hover:bg-[var(--pane-down-strong)]"
                  : "bg-[var(--pane-hover)] opacity-50"
              } ${
                chosen
                  ? "ring-1 ring-[var(--pane-text)]"
                  : cell.date === today
                    ? "ring-1 ring-[var(--pane-accent)]"
                    : ""
              }`}
            >
              <span className="text-[9px] leading-none text-[var(--pane-muted)]">{cell.day}</span>
              {active && (
                <span
                  className={`truncate text-right font-mono text-[10px] leading-none tabular-nums ${
                    up ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                  }`}
                >
                  {money(entry.pnl)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Чем месяц кончился. Мелкой строкой под сеткой: это не итог панели, а
          три числа, которых сама сетка не называет. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--pane-border)] pt-2 text-[10px] text-[var(--pane-muted)]">
        <span>
          {t.journal.winDays}{" "}
          <span className="font-mono tabular-nums text-[var(--pane-text-2)]">
            {wins} / {traded.length}
          </span>
        </span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <span>
          {t.journal.avgDay}{" "}
          <span className={`font-mono tabular-nums ${traded.length > 0 ? tone(average) : ""}`}>
            {traded.length > 0 ? money(average) : "-"}
          </span>
        </span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <span>
          {t.journal.bestDay}{" "}
          <span className={`font-mono tabular-nums ${best ? tone(best.pnl) : ""}`}>
            {best ? money(best.pnl) : "-"}
          </span>
        </span>
      </div>
    </div>
  );
}
