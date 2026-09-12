"use client";

// Табличный: тот же журнал, но разложенный по любому признаку.
//
// Здесь не смотрят, а считают. Вкладка меняет только то, по какому признаку
// сложены сделки, а колонки остаются те же - иначе таблицу пришлось бы читать
// заново на каждом переключении.

import { useMemo, useState } from "react";

import { SESSIONS, breakdown, change, sessionOf, type Row } from "@/lib/analytics/advanced";
import { Big, Card } from "../parts";
import type { ViewProps } from "./types";

type Cut = "symbol" | "side" | "session" | "weekday" | "hour" | "outcome";

const CUTS: Cut[] = ["symbol", "side", "session", "weekday", "hour", "outcome"];

const CHIP =
  "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ease-out";
const CHIP_ON = "border-accent-gold/50 bg-accent-gold/10 text-[var(--pane-gold)]";
const CHIP_OFF =
  "border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]";

export default function TableView({
  trades,
  totals,
  prev,
  symbol,
  onPick,
  money,
  signed,
  a,
}: ViewProps) {
  const [cut, setCut] = useState<Cut>("symbol");

  const rows = useMemo(() => {
    const key = {
      symbol: (t: (typeof trades)[number]) => t.symbol,
      side: (t: (typeof trades)[number]) => t.side,
      session: sessionOf,
      weekday: (t: (typeof trades)[number]) =>
        String((new Date(Date.parse(t.closed_at)).getDay() + 6) % 7),
      hour: (t: (typeof trades)[number]) =>
        String(new Date(Date.parse(t.opened_at ?? t.closed_at)).getHours()),
      outcome: (t: (typeof trades)[number]) => t.outcome,
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-9 gap-y-4 px-1 py-1">
        <Big
          label={a.kpi.net}
          value={signed(totals.net)}
          tone={totals.net >= 0 ? "up" : "down"}
          delta={change(totals.net, prev.net)}
        />
        <Big
          label={a.kpi.winRate}
          value={`${Math.round(totals.winRate * 100)}%`}
          delta={totals.winRate - prev.winRate}
        />
        <Big
          label={a.kpi.profitFactor}
          value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
          tone={totals.profitFactor !== null && totals.profitFactor >= 1 ? "up" : "plain"}
        />
        <Big
          label={a.kpi.drawdown}
          value={money(-totals.drawdown)}
          tone={totals.drawdown > 0 ? "down" : "plain"}
        />
        <Big label={a.kpi.fees} value={money(-totals.fees)} />
        <Big label={a.kpi.avgWin} value={money(totals.avgWin)} tone="up" />
        <Big
          label={a.kpi.hold}
          value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
        />
      </div>

      <Card
        title={a.table.title}
        hint={a.table.hint}
        bodyClass="p-0"
        right={
          <div className="flex flex-wrap gap-1.5">
            {CUTS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setCut(key)}
                className={`${CHIP} ${cut === key ? CHIP_ON : CHIP_OFF}`}
              >
                {a.table.cuts[key]}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[11px]">
            <thead>
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
                    <td className="px-3 py-1.5 font-mono text-[10px] text-[var(--pane-muted)]">
                      {i + 1}
                    </td>
                    <td className="px-2 py-1.5 font-bold text-[var(--pane-text)]">{title(row)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[var(--pane-text-2)]">
                      {row.trades}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono ${
                        rate >= 50 ? "text-[var(--pane-up)]" : "text-[var(--pane-text-2)]"
                      }`}
                    >
                      {rate}%
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono font-bold ${
                        row.pnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                      }`}
                    >
                      {signed(row.pnl)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[var(--pane-text-2)]">
                      {row.avgR === null ? "-" : row.avgR.toFixed(1)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[var(--pane-up)]">
                      {signed(row.best)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[var(--pane-down)]">
                      {money(row.worst)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[var(--pane-muted)]">
                      {money(-row.fees)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-[var(--pane-text-2)]">
                      {row.holdMinutes === null ? "-" : a.minutes(Math.round(row.holdMinutes))}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-8 text-center text-[11px] text-[var(--pane-muted)]"
                  >
                    {a.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Подпись про сессии: границы местные, и без этого их читают как
          биржевые часы. */}
      {cut === "session" && (
        <p className="px-1 text-[10px] text-[var(--pane-muted)]">
          {a.table.sessionsNote(
            SESSIONS.map((one) => `${a.sessions[one.key]} ${one.from}-${one.to}`).join(", "),
          )}
        </p>
      )}
    </div>
  );
}
