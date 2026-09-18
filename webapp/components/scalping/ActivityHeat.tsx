"use client";

// Карта торговли: клетка - день, насыщенность - число сделок.
//
// Цифры за месяц говорят, чем он кончился, но молчат о том, как он шёл. А идёт
// он неровно: три дня по десять сделок, потом неделя тишины. Это и есть режим
// работы, и увидеть его можно только так.
//
// Карта считается от первого дня работы в терминале, но не длиннее девяноста
// дней. Пустые недели до первой сделки - это не тишина в работе, а время, когда
// терминала ещё не было, и рисовать их как пропуски нечестно.
//
// Клетка кликабельна: нажали - разбор открылся на этом дне. Карта здесь не
// украшение, а способ дойти до нужного дня за одно движение вместо трёх.

import { useMemo } from "react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { busiestDay, heatDays, heatLevel, type HeatDay } from "@/lib/activity";
import { money } from "@/lib/journalFormat";
import type { JournalRow } from "./JournalTable";

export interface ActivityHeatProps {
  rows: readonly JournalRow[];
  /** Нажали на клетку: открыть этот день. */
  onPick: (at: Date) => void;
  /** День, открытый сейчас: его клетка обведена. */
  active?: string;
}

/** Цвет клетки по насыщенности. Ноль - самый блёклый: работы в тот день не было. */
function tint(level: number): string {
  if (level === 0) return "bg-[color:color-mix(in_srgb,var(--pane-text)_7%,transparent)]";
  if (level === 1) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_25%,transparent)]";
  if (level === 2) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_50%,transparent)]";
  if (level === 3) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_75%,transparent)]";
  return "bg-[var(--pane-accent)]";
}

export default function ActivityHeat({ rows, onPick, active }: ActivityHeatProps) {
  const t = useT();
  const numbers = useIntlLocale();

  // Первый день работы: раньше него карты нет.
  const started = useMemo(() => {
    const times = rows
      .map((row) => {
        const at = row.closed_at ?? row.opened_at;
        const when = at ? new Date(at).getTime() : NaN;
        return Number.isNaN(when) ? 0 : when;
      })
      .filter((one) => one > 0);
    return times.length > 0 ? Math.min(...times) : 0;
  }, [rows]);

  const cells = useMemo(() => {
    const all = heatDays(rows);
    if (started === 0) return all;
    // Неделя, в которую случилась первая сделка: обрезаем по её понедельнику,
    // чтобы столбцы остались неделями.
    const first = new Date(started);
    const monday = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return all.filter((one) => one.at.getTime() >= monday.getTime());
  }, [rows, started]);

  const busiest = useMemo(() => busiestDay(cells), [cells]);

  // Столбцы - недели, строки - дни недели. Иначе вторник не сравнить с
  // вторником, а именно это на карте и ищут.
  const weeks = useMemo(() => {
    const out: HeatDay[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  // Подпись месяца ставится над той неделей, в которой месяц начался.
  const months = useMemo(
    () =>
      weeks.map((week, i) => {
        const first = week[0];
        if (!first) return "";
        const before = weeks[i - 1]?.[0];
        const same = before && before.at.getMonth() === first.at.getMonth();
        return same ? "" : first.at.toLocaleDateString(numbers, { month: "short" });
      }),
    [weeks, numbers],
  );

  const days = useMemo(() => {
    // Понедельник, вторник, ... - две буквы, как на всех таких картах.
    const week: string[] = [];
    const at = new Date(2026, 8, 14); // понедельник
    for (let i = 0; i < 7; i += 1) {
      week.push(at.toLocaleDateString(numbers, { weekday: "short" }).slice(0, 2));
      at.setDate(at.getDate() + 1);
    }
    return week;
  }, [numbers]);

  const total = cells.reduce((all, one) => all + one.trades, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 py-1.5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
          {t.journal.heatTitle}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-[var(--pane-text-2)]">
          {t.journal.heatTrades(total)}
        </span>
      </div>

      {/* Клетки одного размера, как на любой такой карте: растянутые на всю
          ширину они превращаются в плитку, по которой не видно недель. */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto">
        <div className="flex flex-col gap-[3px] pt-[13px]">
          {days.map((name) => (
            <span
              key={name}
              className="h-[11px] text-[8px] leading-[11px] text-[var(--pane-muted)]"
            >
              {name}
            </span>
          ))}
        </div>

        <div className="flex gap-[3px]">
          {weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              <span className="h-[10px] text-[8px] leading-[10px] text-[var(--pane-muted)]">
                {months[i]}
              </span>
              {week.map((one) => {
                const level = heatLevel(one.trades, busiest);
                return (
                  <button
                    key={one.key}
                    onClick={() => onPick(one.at)}
                    disabled={one.trades === 0}
                    title={`${one.at.toLocaleDateString(numbers, {
                      day: "2-digit",
                      month: "short",
                    })} · ${t.journal.heatTrades(one.trades)}${
                      one.trades > 0 ? ` · ${money(one.pnl)}` : ""
                    }`}
                    className={`h-[11px] w-[11px] rounded-[2px] transition-transform duration-150 ease-out ${tint(
                      level,
                    )} ${
                      active === one.key
                        ? "ring-1 ring-[var(--pane-text)]"
                        : one.trades > 0
                          ? "hover:scale-125 motion-reduce:hover:scale-100"
                          : "cursor-default"
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
