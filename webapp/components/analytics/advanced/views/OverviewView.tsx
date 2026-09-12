"use client";

// Аналитика: весь период на одном экране.
//
// Порядок чтения задан сверху вниз: сперва «сколько» - плитки показателей,
// потом «как шло» - кривая и распределение результата, потом «на чём, когда и
// как долго» - разрезы. Ни одна панель не требует прокрутки: раздел открывают,
// чтобы увидеть картину целиком, а не листать её.

import { useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Clock,
  Coins,
  Flame,
  PieChart,
  Timer,
  TrendingUp,
} from "lucide-react";

import {
  byHoldTime,
  byHour,
  bySide,
  bySymbol,
  byWeekday,
  change,
  daily,
  equityCurve,
  rDistribution,
  SESSIONS,
  streaks,
} from "@/lib/analytics/advanced";
import Bars, { type BarItem } from "../Bars";
import Donut, { DonutLegend, type Slice } from "../Donut";
import EquityCurve from "../EquityCurve";
import RBars from "../RBars";
import RList from "../RList";
import Spark, { SparkRing } from "../Spark";
import { Card, KpiCard, Pick, SymbolList } from "../parts";
import type { ViewProps } from "./types";

/** Цвета дней недели: семь различимых оттенков на одном кольце. */
const WEEK_COLORS = [
  "#0ecb81",
  "#22c3a6",
  "#38bdf8",
  "#7c8cf8",
  "#a97cf0",
  "#f0b90b",
  "#f6746a",
] as const;

/** Чем меряем разрезы по времени: деньгами или числом сделок. */
type Measure = "pnl" | "trades";
/** Как показать распределение по R: формой или числами. */
type RShape = "bars" | "list";
/** Что показывает кольцо разрезов: дни недели или стороны. */
type Ring = "week" | "sides";

export default function OverviewView({
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
  const [measure, setMeasure] = useState<Measure>("pnl");
  const [shape, setShape] = useState<RShape>("bars");
  const [ring, setRing] = useState<Ring>("week");

  const curve = useMemo(() => equityCurve(trades), [trades]);
  const days = useMemo(() => daily(trades), [trades]);
  const risks = useMemo(() => rDistribution(trades), [trades]);
  const sides = useMemo(() => bySide(trades), [trades]);
  const symbols = useMemo(() => bySymbol(trades), [trades]);
  const week = useMemo(() => byWeekday(trades), [trades]);
  const hours = useMemo(() => byHour(trades), [trades]);
  const holds = useMemo(() => byHoldTime(trades), [trades]);
  const series = useMemo(() => streaks(trades), [trades]);

  // Три ряда панелей под полосой показателей. Средний - главный, ему больше.
  const rows = Math.max(430, height - 150);
  const big = Math.round(rows * 0.43) - 48;
  const mid = Math.round(rows * 0.31) - 48;
  const low = rows - Math.round(rows * 0.43) - Math.round(rows * 0.31) - 48;
  const coins = Math.max(4, Math.floor(mid / 26));

  const measures = [
    { key: "pnl" as const, label: a.measures.pnl },
    { key: "trades" as const, label: a.measures.trades },
  ];

  function byMeasure(bucket: { pnl: number; trades: number }): number {
    return measure === "pnl" ? bucket.pnl : bucket.trades;
  }

  const long = sides.find((one) => one.key === "long");
  const short = sides.find((one) => one.key === "short");

  // Из чего сложился итог: плюсы, минусы и комиссии. Комиссии отдельным
  // куском - это единственная его часть, которую задаёт не вход, а объём.
  const totalSlices: Slice[] = [
    {
      key: "wins",
      label: a.total.wins,
      value: totals.gross,
      color: "var(--pane-up)",
      note: signed(totals.gross),
      tone: "up",
    },
    {
      key: "losses",
      label: a.total.losses,
      value: totals.drawn,
      color: "var(--pane-down)",
      note: money(-totals.drawn),
      tone: "down",
    },
    {
      key: "fees",
      // Комиссии своим цветом, а не золотом раздела: тёмное золото светлой
      // темы на кольце выглядит грязным пятном между зелёным и красным.
      label: a.total.fees,
      value: totals.fees,
      color: "#e0932f",
      note: money(-totals.fees),
      tone: "down",
    },
  ];

  const weekSlices: Slice[] = week.map((bucket, i) => ({
    key: bucket.key,
    label: a.weekdays[i],
    value: bucket.trades,
    color: WEEK_COLORS[i],
    note: bucket.trades > 0 ? signed(bucket.pnl) : "",
    tone: bucket.pnl >= 0 ? "up" : "down",
  }));

  const sideSlices: Slice[] = [
    {
      key: "long",
      label: a.sidesTitle.long,
      value: long?.trades ?? 0,
      color: "var(--pane-up)",
      note: signed(long?.pnl ?? 0),
      tone: (long?.pnl ?? 0) >= 0 ? "up" : "down",
    },
    {
      key: "short",
      label: a.sidesTitle.short,
      value: short?.trades ?? 0,
      color: "var(--pane-down)",
      note: signed(short?.pnl ?? 0),
      tone: (short?.pnl ?? 0) >= 0 ? "up" : "down",
    },
  ];

  const size = Math.min(190, Math.max(110, big - 40));
  // Кольцо итога занимает высоту своей панели целиком.
  const totalRing = Math.max(96, low - 4);

  const rings: Record<Ring, { slices: Slice[]; center: React.ReactNode }> = {
    week: {
      slices: weekSlices,
      center: (
        <div>
          <div className="font-mono text-[20px] font-extrabold leading-none text-[var(--pane-text)]">
            {totals.trades}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
            {a.total.short}
          </div>
        </div>
      ),
    },
    sides: {
      slices: sideSlices,
      center: (
        <div>
          <div className="font-mono text-[20px] font-extrabold leading-none text-[var(--pane-text)]">
            {totals.trades}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
            {a.total.short}
          </div>
        </div>
      ),
    },
  };

  return (
    <div className="space-y-2.5">
      {/* Показатели: число, изменение к прошлому периоду и форма рядом. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        <KpiCard
          label={a.kpi.net}
          value={signed(totals.net)}
          tone={totals.net >= 0 ? "up" : "down"}
          delta={change(totals.net, prev.net)}
          chart={
            <Spark
              values={days.map((one) => one.cum)}
              kind="line"
              color={totals.net >= 0 ? "var(--pane-up)" : "var(--pane-down)"}
            />
          }
        />
        <KpiCard
          label={a.kpi.winRate}
          value={`${Math.round(totals.winRate * 100)}%`}
          // Винрейт сравнивается в пунктах, а не в процентах от процентов:
          // «с 70 до 76» это плюс шесть пунктов, и никак не плюс восемь с
          // половиной процентов.
          delta={totals.winRate - prev.winRate}
          chart={<SparkRing fill={totals.winRate} color="var(--pane-up)" size={38} />}
        />
        <KpiCard
          label={a.kpi.profitFactor}
          value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
          tone={totals.profitFactor !== null && totals.profitFactor >= 1 ? "up" : "plain"}
          delta={
            totals.profitFactor !== null && prev.profitFactor !== null
              ? change(totals.profitFactor, prev.profitFactor)
              : null
          }
          chart={
            <Spark
              values={days.map((one) => one.pnl)}
              kind="bars"
              color="var(--pane-up)"
              down="var(--pane-down)"
            />
          }
        />
        <KpiCard
          label={a.kpi.drawdown}
          value={money(-totals.drawdown)}
          tone={totals.drawdown > 0 ? "down" : "plain"}
          note={totals.drawdownPct > 0 ? `${Math.round(totals.drawdownPct * 100)}%` : a.metrics.none}
          chart={
            <Spark values={days.map((one) => -one.fall)} kind="bars" color="var(--pane-down)" />
          }
        />
        <KpiCard
          label={a.kpi.fees}
          value={money(-totals.fees)}
          note={
            totals.gross > 0
              ? `${Math.round((totals.fees / totals.gross) * 100)}% ${a.metrics.ofGross}`
              : a.kpi.feesHint
          }
          chart={<Spark values={days.map((one) => one.fees)} kind="bars" color="var(--pane-muted)" />}
        />
        <KpiCard
          label={a.kpi.avgWin}
          value={money(totals.avgWin)}
          tone="up"
          delta={change(totals.avgWin, prev.avgWin)}
          chart={
            <Spark
              values={days.map((one) => (one.wins > 0 ? one.pnl / one.wins : 0))}
              kind="bars"
              color="var(--pane-up)"
              down="var(--pane-down)"
            />
          }
        />
        <KpiCard
          label={a.kpi.hold}
          value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
          delta={
            totals.holdMinutes !== null && prev.holdMinutes !== null
              ? change(totals.holdMinutes, prev.holdMinutes)
              : null
          }
          chart={<Spark values={holds.map((one) => one.trades)} kind="bars" color="var(--pane-gold)" />}
        />
      </div>

      <div className="grid gap-2.5 xl:grid-cols-12">
        <Card
          title={a.equity.title}
          hint={a.equity.hint}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          className="xl:col-span-6"
        >
          <EquityCurve
            points={curve}
            height={big}
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
          icon={<BarChart3 className="h-3.5 w-3.5" />}
          className="xl:col-span-3"
          right={
            <Pick
              value={shape}
              options={[
                { key: "bars" as const, label: a.risk.shapeBars },
                { key: "list" as const, label: a.risk.shapeList },
              ]}
              onPick={setShape}
            />
          }
        >
          {shape === "bars" ? (
            <RBars buckets={risks} height={big} money={money} count={a.tradesCount} />
          ) : (
            <RList
              buckets={risks}
              name={(key) => a.rBuckets[key] ?? key}
              money={money}
              height={big}
            />
          )}
        </Card>

        {/* Типы сделок: чего в периоде было больше и что из этого вышло. */}
        <Card
          title={a.rings[ring].title}
          hint={a.rings[ring].hint}
          icon={<PieChart className="h-3.5 w-3.5" />}
          className="xl:col-span-3"
          right={
            <Pick
              value={ring}
              options={[
                { key: "week" as const, label: a.rings.week.tab },
                { key: "sides" as const, label: a.rings.sides.tab },
              ]}
              onPick={setRing}
            />
          }
        >
          <div className="flex items-center gap-3" style={{ height: big }}>
            <Donut
              slices={rings[ring].slices}
              size={size}
              thickness={Math.round(size / 9)}
              center={rings[ring].center}
            />
            <DonutLegend
              slices={rings[ring].slices}
              className="flex-1"
              stacked={ring !== "week"}
              compact={ring === "week"}
              showShare={ring === "week"}
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
            rows={symbols.slice(0, coins)}
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
          right={<Pick value={measure} options={measures} onPick={setMeasure} />}
        >
          <Bars
            items={week.map<BarItem>((bucket, i) => ({
              key: bucket.key,
              label: a.weekdays[i],
              value: byMeasure(bucket),
              note: `${a.tradesCount(bucket.trades)} · ${signed(bucket.pnl)}`,
            }))}
            height={mid}
            format={measure === "pnl" ? signed : a.tradesCount}
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
              label: i % 2 === 0 ? String(i) : "",
              value: byMeasure(bucket),
              note: `${i}:00 · ${a.tradesCount(bucket.trades)} · ${signed(bucket.pnl)}`,
            }))}
            height={mid}
            format={measure === "pnl" ? signed : a.tradesCount}
            back={measure === "pnl" ? hours.map((bucket) => bucket.trades) : undefined}
            bands={SESSIONS.map((one) => ({
              from: one.from,
              to: one.to,
              label: a.sessions[one.key] ?? one.key,
            }))}
          />
        </Card>

        {/* Время в сделке: держат ли позиции столько, сколько собирались. */}
        <Card
          title={a.hold.title}
          hint={a.hold.hint}
          icon={<Timer className="h-3.5 w-3.5" />}
          className="xl:col-span-6"
        >
          <RBars
            buckets={holds.map((bucket) => ({ ...bucket, key: a.holdBuckets[bucket.key] ?? bucket.key }))}
            height={low}
            money={money}
            count={a.tradesCount}
            positive
          />
        </Card>

        <Card
          title={a.streaks.title}
          hint={a.streaks.hint}
          icon={<Flame className="h-3.5 w-3.5" />}
          className="xl:col-span-3"
        >
          <div className="grid gap-1.5" style={{ minHeight: low }}>
            <StreakTile
              label={a.streaks.best}
              value={String(series.best.length)}
              note={signed(series.best.pnl)}
              tone="up"
            />
            <StreakTile
              label={a.streaks.worst}
              value={String(series.worst.length)}
              note={signed(series.worst.pnl)}
              tone="down"
            />
            <StreakTile
              label={a.streaks.current}
              value={`${series.now.length > 0 ? "+" : ""}${series.now.length}`}
              note={signed(series.now.pnl)}
              tone={series.now.length >= 0 ? "up" : "down"}
            />
          </div>
        </Card>

        {/* Итог кольцом: из чего он сложился. Комиссии отдельным куском - это
            единственная его часть, которую задаёт не вход, а объём и тариф. */}
        <Card
          title={a.total.title}
          hint={a.total.hint}
          icon={<PieChart className="h-3.5 w-3.5" />}
          className="xl:col-span-3"
        >
          {/* Кольцо во всю высоту панели, легенда - во всю её ширину: иначе
              треть карточки оставалась пустым полем. */}
          <div className="flex items-stretch gap-4" style={{ height: low }}>
            <Donut
              slices={totalSlices}
              size={totalRing}
              thickness={Math.round(totalRing / 9)}
              center={
                <div className="px-3">
                  <div
                    className={`font-mono text-[19px] font-extrabold leading-none tracking-tight ${
                      totals.net >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                    }`}
                  >
                    {signed(totals.net)}
                  </div>
                  <div className="mt-1.5 text-[8px] uppercase tracking-[0.18em] text-[var(--pane-muted)]">
                    {a.total.label}
                  </div>
                  <div className="mt-1 text-[9px] font-semibold text-[var(--pane-text-2)]">
                    {totals.trades}
                  </div>
                </div>
              }
            />
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <DonutLegend slices={totalSlices} stacked bars />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Плитка серии: длина крупно, деньги рядом. */
function StreakTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "up" | "down";
}) {
  const color = tone === "up" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]";
  return (
    <div className="flex flex-col justify-center rounded-lg bg-[var(--pane-hover)] px-3 py-1.5">
      <div className="truncate text-[9px] uppercase leading-tight tracking-wider text-[var(--pane-muted)]">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-[19px] font-extrabold leading-tight ${color}`}>{value}</span>
        <span className={`font-mono text-[12px] font-bold ${color}`}>{note}</span>
      </div>
    </div>
  );
}
