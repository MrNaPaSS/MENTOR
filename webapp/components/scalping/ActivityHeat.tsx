"use client";

// Карта торговли: клетка - день, насыщенность - число сделок.
//
// Цифры за месяц говорят, чем он кончился, но молчат о том, как он шёл. А идёт
// он неровно: три дня по десять сделок, потом неделя тишины. Это и есть режим
// работы, и увидеть его можно только так.
//
// Клетка кликабельна: нажали - архив открылся на этом дне. Карта здесь не
// украшение, а способ дойти до нужного дня за одно движение вместо трёх.

import { useMemo } from "react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { busiestDay, heatDays, heatLevel, type HeatDay } from "@/lib/activity";
import { money } from "@/lib/journalFormat";
import type { JournalRow } from "./JournalTable";

export interface ActivityHeatProps {
  rows: readonly JournalRow[];
  /** Нажали на клетку: открыть этот день в архиве. */
  onPick: (at: Date) => void;
  /** День, открытый сейчас: его клетка обведена. */
  active?: string;
}

/** Цвет клетки по насыщенности. Ноль - пустая: работы в этот день не было. */
function tint(level: number): string {
  if (level === 0) return "bg-[var(--pane-hover)]";
  if (level === 1) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_22%,transparent)]";
  if (level === 2) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_45%,transparent)]";
  if (level === 3) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_70%,transparent)]";
  return "bg-[var(--pane-accent)]";
}

export default function ActivityHeat({ rows, onPick, active }: ActivityHeatProps) {
  const t = useT();
  const numbers = useIntlLocale();

  const cells = useMemo(() => heatDays(rows), [rows]);
  const busiest = useMemo(() => busiestDay(cells), [cells]);

  // Столбцы - недели, строки - дни недели. Иначе вторник не сравнить с
  // вторником, а именно это на карте и ищут.
  const weeks = useMemo(() => {
    const out: HeatDay[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  const total = cells.reduce((all, one) => all + one.trades, 0);

  return (
    <div className="border-t border-[var(--pane-border)] px-2 py-1.5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
          {t.journal.heatTitle}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-[var(--pane-text-2)]">
          {t.journal.heatTrades(total)}
        </span>
      </div>

      <div className="flex gap-[2px] overflow-x-auto">
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-[2px]">
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
                  className={`h-[9px] w-[9px] rounded-[2px] transition-transform duration-150 ease-out ${tint(
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

      {/* Шкала: что значит бледное и что насыщенное. Без неё карта - узор. */}
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[9px] text-[var(--pane-muted)]">{t.journal.heatLess}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`h-[8px] w-[8px] rounded-[2px] ${tint(level)}`} />
        ))}
        <span className="text-[9px] text-[var(--pane-muted)]">{t.journal.heatMore}</span>
      </div>
    </div>
  );
}
