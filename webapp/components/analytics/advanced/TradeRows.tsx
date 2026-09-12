"use client";

// Крайние сделки и серии: две мелочи «Визуального» вида.
//
// Вынесены из вида, потому что строка сделки нужна и в «Классике», когда монета
// отфильтрована: там на месте разреза по монетам встают те же три лучших и три
// худших.

import { rMultiple } from "@/lib/analytics/advanced";
import type { JournalTrade } from "@/lib/journal";

/** Список сделок: монета, сторона, R, дата и результат. */
export function TradeList({
  rows,
  sides,
  day,
  money,
  empty,
}: {
  rows: readonly JournalTrade[];
  sides: Record<"long" | "short", string>;
  day: (ms: number) => string;
  money: (value: number) => string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-5 text-center text-[11px] text-[var(--pane-muted)]">{empty}</p>;
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const r = rMultiple(row);
        const long = row.side === "long";
        return (
          <div
            key={row.id}
            className="flex items-center gap-2 rounded-lg bg-[var(--pane-hover)] px-2 py-1.5 text-[11px]"
          >
            <span className="w-12 shrink-0 truncate font-bold text-[var(--pane-text)]">
              {row.symbol.replace(/USDT$/, "")}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                long
                  ? "bg-[var(--pane-up-faint)] text-[var(--pane-up)]"
                  : "bg-[var(--pane-down-faint)] text-[var(--pane-down)]"
              }`}
            >
              {sides[row.side]}
            </span>
            <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-[var(--pane-muted)]">
              {r === null ? "" : `${r > 0 ? "+" : ""}${r.toFixed(1)}R`}
            </span>
            <span className="w-14 shrink-0 text-right text-[10px] text-[var(--pane-muted)]">
              {day(Date.parse(row.closed_at))}
            </span>
            <span
              className={`w-16 shrink-0 text-right font-mono font-bold ${
                row.pnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
              }`}
            >
              {money(row.pnl)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Строка серии: длина крупно, деньги рядом. */
export function StreakRow({
  label,
  length,
  note,
  tone,
  current = false,
}: {
  label: string;
  length: number;
  note: string;
  tone: "up" | "down";
  /** Серия, которая идёт прямо сейчас: её выделяем подложкой. */
  current?: boolean;
}) {
  const color = tone === "up" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]";

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        current ? "bg-[var(--pane-hover)]" : ""
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--pane-text-2)]">{label}</span>
      <span className={`font-mono text-[16px] font-extrabold leading-none ${color}`}>{length}</span>
      <span className={`w-20 text-right font-mono text-[11px] font-bold ${color}`}>{note}</span>
    </div>
  );
}
