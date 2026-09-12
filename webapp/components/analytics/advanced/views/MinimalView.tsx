"use client";

// Минимализм: голые числа и одна большая кривая.
//
// Рамок нет намеренно. Когда показателей семь, рамка вокруг каждого добавляет
// к экрану четырнадцать линий, которые не значат ничего: числа и так стоят в
// ряд, и граница между ними видна по пустому месту.

import { useMemo } from "react";

import { R_BUCKETS, change, equityCurve, rDistribution } from "@/lib/analytics/advanced";
import EquityCurve from "../EquityCurve";
import { Big, Card } from "../parts";
import type { ViewProps } from "./types";

export default function MinimalView({
  trades,
  totals,
  prev,
  money,
  signed,
  day,
  height,
  a,
}: ViewProps) {
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const risks = useMemo(() => rDistribution(trades), [trades]);
  const counted = risks.reduce((sum, bucket) => sum + bucket.trades, 0);
  // Ряд голых чисел, зазор и шапка панели - остальное отдаём кривой.
  const chart = Math.max(300, height - 130);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4 px-1 py-1">
        <Big
          label={a.kpi.net}
          value={signed(totals.net)}
          tone={totals.net >= 0 ? "up" : "down"}
          delta={change(totals.net, prev.net)}
          size={28}
        />
        <Big
          label={a.kpi.winRate}
          value={`${Math.round(totals.winRate * 100)}%`}
          delta={totals.winRate - prev.winRate}
          size={28}
        />
        <Big
          label={a.kpi.profitFactor}
          value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
          tone={totals.profitFactor !== null && totals.profitFactor >= 1 ? "up" : "plain"}
          delta={
            totals.profitFactor !== null && prev.profitFactor !== null
              ? change(totals.profitFactor, prev.profitFactor)
              : null
          }
          size={28}
        />
        <Big
          label={a.kpi.drawdown}
          value={money(-totals.drawdown)}
          tone={totals.drawdown > 0 ? "down" : "plain"}
          size={28}
        />
        <Big label={a.kpi.fees} value={money(-totals.fees)} size={28} />
        <Big
          label={a.kpi.avgWin}
          value={money(totals.avgWin)}
          tone="up"
          delta={change(totals.avgWin, prev.avgWin)}
          size={28}
        />
        <Big
          label={a.kpi.hold}
          value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
          delta={
            totals.holdMinutes !== null && prev.holdMinutes !== null
              ? change(totals.holdMinutes, prev.holdMinutes)
              : null
          }
          size={28}
        />
      </div>

      <div className="grid gap-2.5 xl:grid-cols-12">
        <Card title={a.equity.title} className="xl:col-span-8">
          <EquityCurve
            points={curve}
            height={chart}
            money={money}
            day={day}
            labelTrade={a.equity.account}
            labelResult={a.equity.result}
            empty={a.empty}
          />
        </Card>

        {/* Итоги по результату списком: тот же разрез, что столбиками в других
            видах, но читается числами, а не на глаз. */}
        <Card title={a.risk.titleTotals} className="self-start xl:col-span-4" bodyClass="p-1.5">
          <div className="space-y-0.5">
            {[...risks].reverse().map((bucket) => {
              const share = counted > 0 ? bucket.trades / counted : 0;
              const loss = R_BUCKETS.find((one) => one.key === bucket.key)?.to ?? 0;
              return (
                <div
                  key={bucket.key}
                  className="flex items-center gap-2 rounded-lg px-2 py-[5px] text-[11px] odd:bg-[var(--pane-hover)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--pane-text-2)]">
                    {a.rBuckets[bucket.key] ?? bucket.key}
                  </span>
                  <span
                    className={`w-10 text-right font-mono font-bold ${
                      loss <= 0 ? "text-[var(--pane-down)]" : "text-[var(--pane-up)]"
                    }`}
                  >
                    {Math.round(share * 100)}%
                  </span>
                  <span className="w-7 text-right font-mono text-[10px] text-[var(--pane-muted)]">
                    {bucket.trades}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
