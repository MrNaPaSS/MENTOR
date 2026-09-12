"use client";

// Профессиональный: кривая с линией ровного темпа и датчики качества.
//
// Датчик вместо числа там, где у величины есть понятный потолок: винрейт,
// профит-фактор, просадка. Дуга отвечает на вопрос «это хорошо?» раньше, чем
// человек успевает вспомнить, какой профит-фактор считается приличным.

import { useMemo } from "react";
import { CalendarDays, Clock, Coins, Gauge as GaugeIcon, TrendingUp } from "lucide-react";

import { byHour, bySymbol, byWeekday, equityCurve, evenPace } from "@/lib/analytics/advanced";
import Bars, { type BarItem } from "../Bars";
import EquityCurve from "../EquityCurve";
import Gauge from "../Gauge";
import { Card, Metric, SymbolList } from "../parts";
import type { ViewProps } from "./types";

/** Профит-фактор выше этого уже ничего не добавляет к «хорошо». */
const PF_GOOD = 3;
/** Просадка глубже этой доли пика - «плохо» на всю дугу. */
const DD_BAD = 0.4;

export default function ProView({
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
  const pace = useMemo(() => evenPace(curve), [curve]);
  const symbols = useMemo(() => bySymbol(trades), [trades]);
  const week = useMemo(() => byWeekday(trades), [trades]);
  const hours = useMemo(() => byHour(trades), [trades]);

  // Два ряда: кривая с датчиками и три разреза под ними.
  const rows = Math.max(360, height - 34);
  const chart = Math.round(rows * 0.62) - 48;
  const small = rows - Math.round(rows * 0.62) - 48;
  // Монет столько, сколько помещается в отведённую разрезу высоту.
  const top = Math.max(5, Math.floor(small / 24));
  // Датчик растёт вместе с панелью: в высокой рамке маленькая дуга
  // выглядит значком, а не показателем.
  const dial = Math.min(150, Math.max(92, chart - 180));

  return (
    <div className="grid gap-2.5 xl:grid-cols-12">
      <Card
        title={a.equity.title}
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        className="xl:col-span-7"
        right={
          <span className="flex items-center gap-3 text-[10px] text-[var(--pane-muted)]">
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-4 rounded bg-[var(--pane-up)]" />
              {a.equity.account}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="h-0.5 w-4 rounded"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(90deg, var(--pane-muted) 0 4px, transparent 4px 7px)",
                }}
              />
              {a.equity.pace}
            </span>
          </span>
        }
      >
        <EquityCurve
          points={curve}
          pace={pace}
          height={chart}
          money={money}
          day={day}
          labelTrade={a.equity.account}
          labelResult={a.equity.result}
          empty={a.empty}
        />
      </Card>

      <Card
        title={a.metrics.title}
        hint={a.metrics.hint}
        icon={<GaugeIcon className="h-3.5 w-3.5" />}
        className="xl:col-span-5"
      >
        <div
          className="flex items-center justify-around gap-2"
          style={{ height: Math.max(96, chart - 86) }}
        >
          <Gauge
            fill={totals.winRate}
            value={`${Math.round(totals.winRate * 100)}%`}
            label={a.kpi.winRate}
            size={dial}
            color="var(--pane-up)"
          />
          <Gauge
            fill={Math.min(1, (totals.profitFactor ?? 0) / PF_GOOD)}
            value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
            label={a.kpi.profitFactor}
            size={dial}
            color="var(--pane-up)"
          />
          <Gauge
            fill={Math.min(1, totals.drawdownPct / DD_BAD)}
            value={`${Math.round(totals.drawdownPct * 100)}%`}
            label={a.kpi.drawdown}
            size={dial}
            color="var(--pane-down)"
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <Metric
            label={a.kpi.net}
            value={signed(totals.net)}
            tone={totals.net >= 0 ? "up" : "down"}
            note={a.tradesCount(totals.trades)}
          />
          <Metric
            label={a.kpi.fees}
            value={money(-totals.fees)}
            note={
              totals.gross > 0
                ? `${Math.round((totals.fees / totals.gross) * 100)}% ${a.metrics.ofGross}`
                : a.kpi.feesHint
            }
          />
          <Metric
            label={a.kpi.avgWin}
            value={money(totals.avgWin)}
            tone="up"
            note={a.metrics.avgLoss(money(-totals.avgLoss))}
          />
          <Metric
            label={a.kpi.hold}
            value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
            note={a.metrics.holdNote}
          />
        </div>
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

      {/* Изменение к прошлому периоду вынесено в подпись: датчик показывает
          сегодняшнее состояние, а не движение, и стрелка внутри него спорила
          бы с дугой. */}
      {prev.trades > 0 && (
        <p className="col-span-full -mt-1 px-1 text-[10px] text-[var(--pane-muted)]">
          {a.metrics.versus(
            signed(prev.net),
            `${Math.round(prev.winRate * 100)}%`,
            prev.profitFactor === null ? "-" : prev.profitFactor.toFixed(2),
          )}
        </p>
      )}
    </div>
  );
}
