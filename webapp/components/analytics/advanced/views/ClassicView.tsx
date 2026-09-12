"use client";

// Классика: полоса показателей, кривая с распределением и три разреза внизу.
//
// Вид по умолчанию. Всё, что обычно спрашивают о периоде, стоит на одном
// экране в привычном порядке: сперва «сколько», потом «как шло», потом «на чём
// и когда».

import { useMemo } from "react";
import { BarChart2, CalendarDays, Clock, Coins, TrendingUp } from "lucide-react";

import {
  byHour,
  bySymbol,
  byWeekday,
  change,
  equityCurve,
  rDistribution,
} from "@/lib/analytics/advanced";
import Bars, { type BarItem } from "../Bars";
import EquityCurve from "../EquityCurve";
import RBars from "../RBars";
import { Card, Kpi, SymbolList } from "../parts";
import type { ViewProps } from "./types";

export default function ClassicView({
  trades,
  totals,
  prev,
  symbol,
  onPick,
  money,
  signed,
  day,
  height,
  a,
}: ViewProps) {
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const risks = useMemo(() => rDistribution(trades), [trades]);
  const symbols = useMemo(() => bySymbol(trades), [trades]);
  const week = useMemo(() => byWeekday(trades), [trades]);
  const hours = useMemo(() => byHour(trades), [trades]);

  // Полоса показателей, два зазора и шапки панелей - остальное делят
  // между собой кривая и разрезы под ней.
  const rows = Math.max(360, height - 88);
  const chart = Math.round(rows * 0.6) - 48;
  const small = rows - Math.round(rows * 0.6) - 48;
  // Монет столько, сколько помещается в отведённую разрезу высоту:
  // пять строк на большом мониторе оставляли под собой пустое поле.
  const top = Math.max(5, Math.floor(small / 24));

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi
          label={a.kpi.net}
          value={signed(totals.net)}
          tone={totals.net >= 0 ? "up" : "down"}
          delta={change(totals.net, prev.net)}
        />
        <Kpi
          label={a.kpi.winRate}
          value={`${Math.round(totals.winRate * 100)}%`}
          // Винрейт сравнивается в пунктах, а не в процентах от процентов:
          // «с 70 до 76» это плюс шесть пунктов, и никак не плюс восемь с
          // половиной процентов.
          delta={totals.winRate - prev.winRate}
        />
        <Kpi
          label={a.kpi.profitFactor}
          value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
          tone={totals.profitFactor !== null && totals.profitFactor >= 1 ? "up" : "plain"}
          delta={
            totals.profitFactor !== null && prev.profitFactor !== null
              ? change(totals.profitFactor, prev.profitFactor)
              : null
          }
        />
        <Kpi
          label={a.kpi.drawdown}
          value={money(-totals.drawdown)}
          tone={totals.drawdown > 0 ? "down" : "plain"}
          note={totals.drawdownPct > 0 ? `${Math.round(totals.drawdownPct * 100)}%` : a.metrics.none}
        />
        <Kpi
          label={a.kpi.fees}
          value={money(-totals.fees)}
          note={
            totals.gross > 0
              ? `${Math.round((totals.fees / totals.gross) * 100)}% ${a.metrics.ofGross}`
              : a.kpi.feesHint
          }
        />
        <Kpi
          label={a.kpi.avgWin}
          value={money(totals.avgWin)}
          tone="up"
          delta={change(totals.avgWin, prev.avgWin)}
        />
        <Kpi
          label={a.metrics.avgLossLabel}
          value={money(-totals.avgLoss)}
          tone="down"
          delta={change(totals.avgLoss, prev.avgLoss)}
        />
        <Kpi
          label={a.kpi.hold}
          value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
          delta={
            totals.holdMinutes !== null && prev.holdMinutes !== null
              ? change(totals.holdMinutes, prev.holdMinutes)
              : null
          }
        />
      </div>

      <div className="grid gap-2.5 xl:grid-cols-12">
        <Card
          title={a.equity.title}
          hint={a.equity.hint}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          className="xl:col-span-8"
        >
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

        <Card
          title={a.risk.title}
          hint={a.risk.hint}
          icon={<BarChart2 className="h-3.5 w-3.5" />}
          className="xl:col-span-4"
        >
          <RBars buckets={risks} height={chart} money={money} count={a.tradesCount} />
        </Card>

        <Card
          title={a.symbols.title}
          hint={a.symbols.hint}
          icon={<Coins className="h-3.5 w-3.5" />}
          className="xl:col-span-4"
        >
          <SymbolList
            rows={symbols.slice(0, top)}
            picked={symbol}
            onPick={onPick}
            money={signed}
            empty={a.empty}
          />
        </Card>

        <Card
          title={a.week.titleResult}
          hint={a.week.hintResult}
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          className="xl:col-span-4"
        >
          <Bars
            items={week.map<BarItem>((bucket, i) => ({
              key: bucket.key,
              label: a.weekdays[i],
              value: bucket.pnl,
              note: a.tradesCount(bucket.trades),
            }))}
            height={small}
            format={signed}
          />
        </Card>

        <Card
          title={a.hours.title}
          hint={a.hours.hint}
          icon={<Clock className="h-3.5 w-3.5" />}
          className="xl:col-span-4"
        >
          <Bars
            items={hours.map<BarItem>((bucket, i) => ({
              key: bucket.key,
              label: i % 3 === 0 ? String(i) : "",
              value: bucket.pnl,
              note: `${i}:00 · ${a.tradesCount(bucket.trades)}`,
            }))}
            height={small}
            format={signed}
          />
        </Card>
      </div>
    </div>
  );
}
