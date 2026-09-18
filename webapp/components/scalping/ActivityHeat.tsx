"use client";

// Карта торговли: клетка - день, насыщенность - число сделок.
//
// Цифры за месяц говорят, чем он кончился, но молчат о том, как он шёл. А идёт
// он неровно: три дня по десять сделок, потом неделя тишины. Это и есть режим
// работы, и увидеть его можно только так.
//
// Поле расчерчено как тетрадь в клетку: девяносто дней ровной сеткой во всю
// ширину и высоту виджета. Размеры клеток считает сам браузер - поэтому они
// одинаковы до пикселя, и справа не остаётся пустой полосы. Клетка заливается
// цветом, когда в этот день торговали, и остаётся пустой, когда нет; дни до
// первой сделки тоже пусты - терминала тогда не было, но без них поле
// перестаёт быть полем.
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
  /**
   * День, с которого человек в терминале.
   *
   * Карта ведётся отсюда, а не с первой сделки: день без сделок - это тоже
   * работа, человек смотрел рынок и не нашёл входа. До регистрации клеток нет
   * вовсе - терминала тогда не было.
   */
  since?: string | null;
  /** Нажали на клетку: открыть этот день. */
  onPick: (at: Date) => void;
  /** День, открытый сейчас: его клетка обведена. */
  active?: string;
}

/** Высота строки с названиями месяцев над полем. */
const MONTH_ROW = 11;

/** Ширина колонки с днями недели слева от поля. */
const DAY_COL = 18;

/** Заливка клетки по насыщенности. Ноль - пустая клетка, без заливки. */
function tint(level: number): string {
  if (level === 0) return "";
  if (level === 1) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_25%,transparent)]";
  if (level === 2) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_50%,transparent)]";
  if (level === 3) return "bg-[color:color-mix(in_srgb,var(--pane-accent)_75%,transparent)]";
  return "bg-[var(--pane-accent)]";
}

export default function ActivityHeat({ rows, since, onPick, active }: ActivityHeatProps) {
  const t = useT();
  const numbers = useIntlLocale();

  // Полночь дня регистрации: раньше него карты нет.
  const born = useMemo(() => {
    if (!since) return 0;
    const at = new Date(since);
    if (Number.isNaN(at.getTime())) return 0;
    return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  }, [since]);

  // Поле всегда на торговый квартал - тринадцать недель. Обрезать его по дню
  // регистрации значит растянуть клетки на пол-виджета у новичка и сжать у
  // старожила: одна и та же карта выглядела бы по-разному у разных людей.
  // Дни до регистрации просто пусты.
  const cells = useMemo(() => heatDays(rows), [rows]);

  const busiest = useMemo(() => busiestDay(cells), [cells]);

  // Столбцы - недели, строки - дни недели. Иначе вторник не сравнить с
  // вторником, а именно это на карте и ищут.
  const weeks = useMemo(() => {
    const out: (HeatDay | null)[][] = [];
    const first = cells[0];
    const pad = first ? (first.at.getDay() + 6) % 7 : 0;
    // Неделя, в которую человек зарегистрировался, почти всегда неполная:
    // дни до него - пустое место, а не клетка, их в счёте нет.
    const line: (HeatDay | null)[] = Array.from({ length: pad }, () => null);

    for (const one of cells) {
      line.push(one);
      if (line.length === 7) {
        out.push([...line]);
        line.length = 0;
      }
    }
    if (line.length > 0) {
      while (line.length < 7) line.push(null);
      out.push([...line]);
    }
    return out;
  }, [cells]);

  // Подпись месяца ставится над той неделей, в которой месяц начался - по
  // первому числу внутри неё, а не по понедельнику. Неделя с 31 августа по
  // 6 сентября - это сентябрь: месяц начался в ней, и подписывать её августом
  // значит сдвинуть весь счёт на месяц назад.
  // Подпись месяца - над той неделей, в которой месяц начался, по первому
  // числу внутри неё: неделя с 31 августа по 6 сентября это сентябрь.
  const months = useMemo(
    () =>
      weeks.map((week) => {
        const opens = week.find((one) => one !== null && one.at.getDate() === 1);
        return opens ? opens.at.toLocaleDateString(numbers, { month: "short" }) : "";
      }),
    [weeks, numbers],
  );

  const days = useMemo(() => {
    const week: string[] = [];
    const at = new Date(2026, 8, 14); // понедельник
    for (let i = 0; i < 7; i += 1) {
      week.push(at.toLocaleDateString(numbers, { weekday: "short" }).slice(0, 2));
      at.setDate(at.getDate() + 1);
    }
    return week;
  }, [numbers]);

  const total = cells
    .filter((one) => born === 0 || one.at.getTime() >= born)
    .reduce((sum, one) => sum + one.trades, 0);
  const columns = `repeat(${Math.max(weeks.length, 1)}, minmax(0, 1fr))`;
  const lines = "repeat(7, minmax(0, 1fr))";

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

      <div
        className="grid min-h-0 flex-1 gap-1"
        style={{
          gridTemplateColumns: `${DAY_COL}px minmax(0, 1fr)`,
          gridTemplateRows: `${MONTH_ROW}px minmax(0, 1fr)`,
        }}
      >
        {/* Пустой угол над днями недели. */}
        <div />

        <div className="grid gap-[2px]" style={{ gridTemplateColumns: columns }}>
          {months.map((name, i) => (
            <span
              key={i}
              className="truncate text-[8px] text-[var(--pane-muted)]"
              style={{ lineHeight: `${MONTH_ROW}px` }}
            >
              {name}
            </span>
          ))}
        </div>

        <div className="grid min-h-0 gap-[2px]" style={{ gridTemplateRows: lines }}>
          {days.map((name) => (
            <span key={name} className="flex items-center text-[8px] text-[var(--pane-muted)]">
              {name}
            </span>
          ))}
        </div>

        {/* Само поле. Порядок по столбцам: неделя сверху вниз, потом следующая -
            так клетка и попадает в свой день недели. */}
        <div
          className="grid min-h-0 gap-[2px]"
          style={{
            gridTemplateColumns: columns,
            gridTemplateRows: lines,
            gridAutoFlow: "column",
          }}
        >
          {weeks.map((week, w) =>
            week.map((one, d) => {
              if (one === null) return <span key={`gap-${w}-${d}`} />;
              // До регистрации терминала у человека не было: место под день
              // остаётся, клетки нет.
              if (born > 0 && one.at.getTime() < born) {
                return <span key={one.key} />;
              }
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
                  className={`min-h-0 min-w-0 rounded-[3px] border border-[var(--pane-border)] transition-colors duration-150 ease-out ${tint(
                    level,
                  )} ${
                    active === one.key
                      ? "ring-1 ring-[var(--pane-text)]"
                      : one.trades > 0
                        ? "hover:border-[var(--pane-accent)]"
                        : "cursor-default"
                  }`}
                />
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
