"use client";

// Разбор по признаку: журнал, сложенный по монете, стороне, сессии, дню, часу
// или исходу.
//
// Вкладка меняет только то, по какому признаку сложены сделки, а колонки
// остаются те же: иначе таблицу приходилось бы читать заново на каждом
// переключении. Здесь не смотрят, а считают - поэтому числами, а не полосами.

import { useMemo } from "react";

import { breakdown, sessionOf, type Row } from "@/lib/analytics/advanced";
import type { JournalTrade } from "@/lib/journal";
import { CoinDot, Pick } from "./parts";
import type { AdvancedDict } from "./views/types";

export type Cut = "symbol" | "side" | "session" | "weekday" | "hour" | "outcome";

const CUTS: Cut[] = ["symbol", "side", "session", "weekday", "hour", "outcome"];

export interface BreakdownTableProps {
  trades: readonly JournalTrade[];
  /** По какому признаку сложены сделки. */
  cut: Cut;
  /** Отобранная монета: её строка подсвечена. */
  symbol: string | null;
  onPick: (key: string) => void;
  money: (value: number) => string;
  signed: (value: number) => string;
  /** Высота тела таблицы: за ней начинается прокрутка внутри панели. */
  height: number;
  a: AdvancedDict;
}

/** Вкладки разрезов для шапки панели: состояние держит сам вид. */
export function CutTabs({
  cut,
  onPick,
  a,
}: {
  cut: Cut;
  onPick: (cut: Cut) => void;
  a: AdvancedDict;
}) {
  return (
    <Pick
      value={cut}
      options={CUTS.map((key) => ({ key, label: a.table.cuts[key] }))}
      onPick={onPick}
    />
  );
}

export default function BreakdownTable({
  trades,
  cut,
  symbol,
  onPick,
  money,
  signed,
  height,
  a,
}: BreakdownTableProps) {
  const rows = useMemo(() => {
    const key = {
      symbol: (trade: JournalTrade) => trade.symbol,
      side: (trade: JournalTrade) => trade.side,
      session: sessionOf,
      weekday: (trade: JournalTrade) =>
        String((new Date(Date.parse(trade.closed_at)).getDay() + 6) % 7),
      hour: (trade: JournalTrade) =>
        String(new Date(Date.parse(trade.opened_at ?? trade.closed_at)).getHours()),
      outcome: (trade: JournalTrade) => trade.outcome,
    }[cut];
    return breakdown(trades, key).sort((x, y) => y.pnl - x.pnl);
  }, [trades, cut]);

  /** Название строки: у каждого разреза оно своё. */
  function title(row: Row): string {
    if (cut === "symbol") return row.key.replace(/USDT$/, "");
    if (cut === "side") return a.sides[row.key as "long" | "short"] ?? row.key;
    if (cut === "session") return a.sessions[row.key] ?? row.key;
    if (cut === "weekday") return a.weekdays[Number(row.key)] ?? row.key;
    if (cut === "hour") return `${row.key}:00`;
    return a.outcomes[row.key as "take" | "stop" | "manual"] ?? row.key;
  }

  return (
    <div className="overflow-auto" style={{ height }}>
      <table className="w-full min-w-[820px] border-collapse text-[11px]">
        <thead className="sticky top-0 z-10 bg-[var(--pane-bg)]">
          <tr className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
            <th className="w-8 px-3 py-1.5 text-left font-semibold">#</th>
            <th className="px-2 py-1.5 text-left font-semibold">{a.table.cuts[cut]}</th>
            <th className="px-2 py-1.5 text-right font-semibold">{a.table.trades}</th>
            <th className="px-2 py-1.5 text-right font-semibold">{a.kpi.winRate}</th>
            <th className="px-2 py-1.5 text-right font-semibold">{a.table.pnl}</th>
            <th className="px-2 py-1.5 text-right font-semibold">{a.table.avgR}</th>
            <th className="px-2 py-1.5 text-right font-semibold">{a.table.best}</th>
            <th className="px-2 py-1.5 text-right font-semibold">{a.table.worst}</th>
            <th className="px-2 py-1.5 text-right font-semibold">{a.kpi.fees}</th>
            <th className="px-3 py-1.5 text-right font-semibold">{a.table.hold}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const rate = row.trades > 0 ? Math.round((row.wins / row.trades) * 100) : 0;
            const picked = cut === "symbol" && symbol === row.key;
            return (
              <tr
                key={row.key}
                onClick={cut === "symbol" ? () => onPick(row.key) : undefined}
                className={`border-t border-[var(--pane-border)] ${
                  cut === "symbol" ? "cursor-pointer" : ""
                } ${picked ? "bg-[var(--pane-hover)]" : "hover:bg-[var(--pane-hover)]"}`}
              >
                <td className="px-3 py-1 font-mono text-[10px] text-[var(--pane-muted)]">{i + 1}</td>
                <td className="px-2 py-1">
                  <span className="flex items-center gap-1.5">
                    {cut === "symbol" && <CoinDot symbol={row.key} size={18} />}
                    <span className="font-bold text-[var(--pane-text)]">{title(row)}</span>
                  </span>
                </td>
                <td className="px-2 py-1 text-right font-mono text-[var(--pane-text-2)]">
                  {row.trades}
                </td>
                <td
                  className={`px-2 py-1 text-right font-mono ${
                    rate >= 50 ? "text-[var(--pane-up)]" : "text-[var(--pane-text-2)]"
                  }`}
                >
                  {rate}%
                </td>
                <td
                  className={`px-2 py-1 text-right font-mono font-bold ${
                    row.pnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                  }`}
                >
                  {signed(row.pnl)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-[var(--pane-text-2)]">
                  {row.avgR === null ? "-" : row.avgR.toFixed(1)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-[var(--pane-up)]">
                  {signed(row.best)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-[var(--pane-down)]">
                  {money(row.worst)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-[var(--pane-muted)]">
                  {money(-row.fees)}
                </td>
                <td className="px-3 py-1 text-right font-mono text-[var(--pane-text-2)]">
                  {row.holdMinutes === null ? "-" : a.minutes(Math.round(row.holdMinutes))}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-8 text-center text-[11px] text-[var(--pane-muted)]">
                {a.empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
