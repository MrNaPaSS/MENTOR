"use client";

// Визуальный: кольца и столбики вместо таблиц.
//
// Числа здесь те же, но читаются долями: не «плюс четыре тысячи и минус
// тысяча двести», а «прибыльные занимают три четверти круга». Так быстрее
// видно перекос - например, что весь период вытянули три сделки.

import { useMemo } from "react";
import { Award, BarChart3, CalendarDays, Flame, PieChart } from "lucide-react";

import { byWeekday, rDistribution, streaks } from "@/lib/analytics/advanced";
import Donut, { DonutLegend, type Slice } from "../Donut";
import RBars from "../RBars";
import { StreakRow, TradeList } from "../TradeRows";
import { Card } from "../parts";
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

export default function VisualView({
  trades,
  totals,
  money,
  signed,
  day,
  height,
  a,
}: ViewProps) {
  const risks = useMemo(() => rDistribution(trades), [trades]);
  const week = useMemo(() => byWeekday(trades), [trades]);
  const series = useMemo(() => streaks(trades), [trades]);
  // Два ряда. Нижнему хватает своей высоты - там три строки и три числа, и
  // растягивать их по экрану нечем: между строками появлялись провалы. Весь
  // остаток забирают кольца, им простор идёт на пользу.
  const rows = Math.max(360, height - 10);
  const bottom = 178;
  const top = Math.max(220, rows - bottom - 10);
  // Кольца растут вместе с панелью: маленький бублик в высокой рамке
  // выглядит потерянным, а доли на нём не разглядеть.
  const ring = Math.min(250, Math.max(140, top - 190));
  const weekRing = Math.min(190, Math.max(110, top - 250));

  const extremes = useMemo(() => {
    const won = trades.filter((trade) => trade.pnl > 0).sort((x, y) => y.pnl - x.pnl);
    const lost = trades.filter((trade) => trade.pnl < 0).sort((x, y) => x.pnl - y.pnl);
    return { best: won.slice(0, 3), worst: lost.slice(0, 3) };
  }, [trades]);

  // Кольцо итога: из чего он сложился. Комиссии отдельным куском - это
  // единственная его часть, которую задаёт не вход, а объём и тариф.
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
      label: a.total.fees,
      value: totals.fees,
      color: "var(--pane-gold)",
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

  return (
    <div className="grid gap-2.5 xl:grid-cols-12">
      <Card
        title={a.total.title}
        hint={a.total.hint}
        icon={<PieChart className="h-3.5 w-3.5" />}
        className="xl:col-span-5"
      >
        <div className="flex items-center gap-5" style={{ height: top - 48 }}>
          <Donut
            slices={totalSlices}
            size={ring}
            thickness={Math.round(ring / 9)}
            center={
              <div className="px-2">
                <div
                  className={`font-mono text-[22px] font-extrabold leading-none ${
                    totals.net >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                  }`}
                >
                  {signed(totals.net)}
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
                  {a.total.label}
                </div>
              </div>
            }
          />
          <div className="min-w-0 flex-1">
            <DonutLegend slices={totalSlices} showShare={false} stacked />
            <div className="mt-2 flex items-baseline justify-between border-t border-[var(--pane-border)] pt-2 text-[11px]">
              <span className="text-[var(--pane-muted)]">{a.total.all}</span>
              <span className="font-mono font-bold text-[var(--pane-text)]">{totals.trades}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title={a.risk.title}
        hint={a.risk.hint}
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        className="xl:col-span-4"
      >
        <RBars buckets={risks} height={top - 48} money={money} count={a.tradesCount} />
      </Card>

      <Card
        title={a.week.title}
        hint={a.week.hint}
        icon={<CalendarDays className="h-3.5 w-3.5" />}
        className="xl:col-span-3"
      >
        <div className="flex items-center gap-3" style={{ height: top - 48 }}>
          <Donut slices={weekSlices} size={weekRing} thickness={Math.round(weekRing / 9)} />
          <DonutLegend slices={weekSlices} className="flex-1" compact />
        </div>
      </Card>

      <Card
        title={a.extremes.best}
        hint={a.extremes.hint}
        icon={<Award className="h-3.5 w-3.5" />}
        className="xl:col-span-4"
      >
        <TradeList
          rows={extremes.best}
          sides={a.sides}
          day={day}
          money={signed}
          empty={a.empty}
        />
      </Card>

      <Card
        title={a.extremes.worst}
        hint={a.extremes.hintWorst}
        icon={<Award className="h-3.5 w-3.5 rotate-180" />}
        className="xl:col-span-4"
      >
        <TradeList
          rows={extremes.worst}
          sides={a.sides}
          day={day}
          money={signed}
          empty={a.empty}
        />
      </Card>

      <Card
        title={a.streaks.title}
        hint={a.streaks.hint}
        icon={<Flame className="h-3.5 w-3.5" />}
        className="xl:col-span-4"
      >
        <div className="space-y-1.5">
          <StreakRow
            label={a.streaks.best}
            length={series.best.length}
            note={signed(series.best.pnl)}
            tone="up"
          />
          <StreakRow
            label={a.streaks.worst}
            length={series.worst.length}
            note={signed(series.worst.pnl)}
            tone="down"
          />
          <StreakRow
            label={a.streaks.current}
            length={Math.abs(series.now.length)}
            note={signed(series.now.pnl)}
            tone={series.now.length >= 0 ? "up" : "down"}
            current
          />
        </div>
      </Card>
    </div>
  );
}
