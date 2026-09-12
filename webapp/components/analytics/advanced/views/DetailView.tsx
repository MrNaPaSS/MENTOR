"use client";

// Детальная аналитика: то же самое, но с точностью до сделки.
//
// Первый экран отвечает на вопрос «как прошёл период», этот - на вопрос
// «почему». Здесь крупная кривая, полный список чисел, последние сделки
// строками и разрезы, в которых видно не долю, а конкретную монету и час.

import { useMemo, useState } from "react";
import {
  Award,
  BarChart3,
  CalendarDays,
  Coins,
  Flame,
  Gauge as GaugeIcon,
  ListOrdered,
  Scale,
  TrendingUp,
} from "lucide-react";

import {
  byHour,
  byOutcome,
  bySession,
  bySide,
  byWeekday,
  evenPace,
  equityCurve,
  latest,
  rMultiple,
  streaks,
} from "@/lib/analytics/advanced";
import Bars, { type BarItem } from "../Bars";
import BreakdownTable, { CutTabs, type Cut } from "../BreakdownTable";
import Gauge from "../Gauge";
import EquityCurve from "../EquityCurve";
import { TradeList } from "../TradeRows";
import { Card, CoinDot, Metric, Pick, price } from "../parts";
import type { ViewProps } from "./types";

/** По какому времени разложен результат. */
type TimeCut = "weekday" | "hour" | "session";
/** Профит-фактор выше этого уже ничего не добавляет к «хорошо». */
const PF_GOOD = 3;
/** Просадка глубже этой доли пика - «плохо» на всю дугу. */
const DD_BAD = 0.4;
/** Сколько последних сделок показываем строками. */
const RECENT = 6;
/** Сколько лучших и худших сделок показываем. */
const EDGE = 2;

export default function DetailView({
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
  const [cut, setCut] = useState<TimeCut>("weekday");
  const [table, setTable] = useState<Cut>("symbol");

  const curve = useMemo(() => equityCurve(trades), [trades]);
  const pace = useMemo(() => evenPace(curve), [curve]);
  const recent = useMemo(() => latest(trades, RECENT), [trades]);
  const sides = useMemo(() => bySide(trades), [trades]);
  const week = useMemo(() => byWeekday(trades), [trades]);
  const hours = useMemo(() => byHour(trades), [trades]);
  const sessions = useMemo(() => bySession(trades), [trades]);
  const outcomes = useMemo(() => byOutcome(trades), [trades]);
  const series = useMemo(() => streaks(trades), [trades]);
  const extremes = useMemo(() => {
    const won = trades.filter((trade) => trade.pnl > 0).sort((x, y) => y.pnl - x.pnl);
    const lost = trades.filter((trade) => trade.pnl < 0).sort((x, y) => x.pnl - y.pnl);
    return { best: won.slice(0, EDGE), worst: lost.slice(0, EDGE) };
  }, [trades]);

  // Четыре ряда: кривая с цифрами, сделки, разрезы, серии. Нижнему ряду
  // хватает своей высоты - там шесть плиток в строку.
  // Четыре ряда, и высоты им задаём числами, а не долями: панелей здесь
  // девять, и доли от высоты окна растягивали страницу вдвое против экрана.
  // Каждому ряду хватает своего: кривой - простора, таблицам - шести строк.
  const free = Math.max(560, height - 40);
  const big = Math.min(230, Math.max(158, Math.round(free * 0.19)));
  const mid = Math.min(180, Math.max(132, Math.round(free * 0.15)));
  const low = Math.min(180, Math.max(130, Math.round(free * 0.17)));
  // Таблица разрезов прокручивается внутри себя, а не тянет за собой страницу.
  const deep = Math.min(150, Math.max(112, Math.round(free * 0.13)));

  const time: Record<TimeCut, BarItem[]> = {
    weekday: week.map((bucket, i) => ({
      key: bucket.key,
      label: a.weekdays[i],
      value: bucket.pnl,
      note: a.tradesCount(bucket.trades),
    })),
    hour: hours.map((bucket, i) => ({
      key: bucket.key,
      label: i % 3 === 0 ? String(i) : "",
      value: bucket.pnl,
      note: `${i}:00 · ${a.tradesCount(bucket.trades)}`,
    })),
    session: sessions.map((bucket) => ({
      key: bucket.key,
      label: a.sessions[bucket.key] ?? bucket.key,
      value: bucket.pnl,
      note: a.tradesCount(bucket.trades),
    })),
  };

  return (
    <div className="grid gap-2.5 xl:grid-cols-12">
      <Card
        title={a.equity.title}
        hint={a.equity.hint}
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        className="xl:col-span-8"
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
          height={big}
          money={money}
          day={day}
          labelTrade={a.equity.account}
          labelResult={a.equity.result}
          empty={a.empty}
        />
      </Card>

      {/* Детальная статистика: всё, что считается по журналу, числами. */}
      <Card
        title={a.stats.title}
        hint={a.stats.hint}
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        className="xl:col-span-4"
      >
        <div className="grid grid-cols-2 gap-x-4">
          <Line label={a.stats.trades} value={String(totals.trades)} />
          <Line
            label={a.kpi.avgWin}
            value={money(totals.avgWin)}
            tone="up"
          />
          <Line
            label={a.stats.wins}
            value={`${totals.wins} (${Math.round(totals.winRate * 100)}%)`}
            tone="up"
          />
          <Line label={a.metrics.avgLossLabel} value={money(-totals.avgLoss)} tone="down" />
          <Line
            label={a.stats.losses}
            value={`${totals.losses} (${Math.round((1 - totals.winRate) * 100)}%)`}
            tone="down"
          />
          <Line
            label={a.kpi.profitFactor}
            value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
          />
          <Line
            label={a.stats.net}
            value={signed(totals.net)}
            tone={totals.net >= 0 ? "up" : "down"}
          />
          <Line label={a.stats.best} value={signed(totals.best)} tone="up" />
          <Line
            label={a.stats.expectancy}
            value={signed(totals.expectancy)}
            tone={totals.expectancy >= 0 ? "up" : "down"}
          />
          <Line label={a.stats.worst} value={money(totals.worst)} tone="down" />
          <Line
            label={a.kpi.avgR}
            value={totals.avgR === null ? "-" : `${totals.avgR >= 0 ? "+" : ""}${totals.avgR.toFixed(2)}R`}
            tone={totals.avgR !== null && totals.avgR >= 0 ? "up" : "down"}
          />
          <Line
            label={a.kpi.drawdown}
            value={money(-totals.drawdown)}
            tone={totals.drawdown > 0 ? "down" : "plain"}
          />
          <Line
            label={a.kpi.hold}
            value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
          />
          <Line
            label={a.kpi.fees}
            value={`${money(-totals.fees)}${
              totals.gross > 0 ? ` (${Math.round((totals.fees / totals.gross) * 100)}%)` : ""
            }`}
            tone="down"
          />
          {prev.trades > 0 && (
            <>
              <Line label={a.stats.prevNet} value={signed(prev.net)} />
              <Line label={a.stats.prevWinRate} value={`${Math.round(prev.winRate * 100)}%`} />
            </>
          )}
        </div>
      </Card>

      {/* Последние сделки: с них начинается любой разбор «что это было». */}
      <Card
        title={a.recent.title}
        hint={a.recent.hint}
        icon={<ListOrdered className="h-3.5 w-3.5" />}
        className="xl:col-span-8"
        bodyClass="p-0"
      >
        <div className="overflow-x-auto" style={{ height: mid + 30 }}>
          <table className="w-full min-w-[700px] border-collapse text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
                <th className="px-3 py-1 text-left font-semibold">{a.recent.coin}</th>
                <th className="px-2 py-1 text-left font-semibold">{a.recent.side}</th>
                <th className="px-2 py-1 text-right font-semibold">{a.recent.entry}</th>
                <th className="px-2 py-1 text-right font-semibold">{a.recent.exit}</th>
                <th className="px-2 py-1 text-right font-semibold">{a.recent.size}</th>
                <th className="px-2 py-1 text-right font-semibold">{a.table.pnl}</th>
                <th className="px-2 py-1 text-right font-semibold">R</th>
                <th className="px-3 py-1 text-right font-semibold">{a.recent.when}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => {
                const r = rMultiple(row);
                const long = row.side === "long";
                return (
                  <tr
                    key={row.id}
                    className="border-t border-[var(--pane-border)] hover:bg-[var(--pane-hover)]"
                  >
                    <td className="px-3 py-1">
                      <span className="flex items-center gap-1.5">
                        <CoinDot symbol={row.symbol} size={18} />
                        <span className="font-bold text-[var(--pane-text)]">
                          {row.symbol.replace(/USDT$/, "")}
                        </span>
                      </span>
                    </td>
                    <td
                      className={`px-2 py-1 font-semibold ${
                        long ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                      }`}
                    >
                      {a.sides[row.side]}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[var(--pane-text-2)]">
                      {price(row.entry)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[var(--pane-text-2)]">
                      {row.exit_price === null ? "-" : price(row.exit_price)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[var(--pane-muted)]">
                      {price(row.qty)}
                    </td>
                    <td
                      className={`px-2 py-1 text-right font-mono font-bold ${
                        row.pnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                      }`}
                    >
                      {signed(row.pnl)}
                    </td>
                    <td
                      className={`px-2 py-1 text-right font-mono ${
                        (r ?? 0) >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                      }`}
                    >
                      {r === null ? "-" : `${r > 0 ? "+" : ""}${r.toFixed(1)}`}
                    </td>
                    <td className="px-3 py-1 text-right text-[10px] text-[var(--pane-muted)]">
                      {day(Date.parse(row.closed_at))}
                    </td>
                  </tr>
                );
              })}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[11px] text-[var(--pane-muted)]">
                    {a.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={a.extremes.title}
        hint={a.extremes.hint}
        icon={<Award className="h-3.5 w-3.5" />}
        className="xl:col-span-4"
      >
        {/* Высоту держим по соседней таблице: панель с двумя списками сама по
            себе выше её на строку, и из-за одной строки страница переставала
            помещаться в экран. */}
        <div className="flex flex-col justify-between gap-1" style={{ height: mid + 30 }}>
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
              {a.extremes.best}
            </div>
            <TradeList rows={extremes.best} sides={a.sides} day={day} money={signed} empty={a.empty} />
          </div>
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
              {a.extremes.worst}
            </div>
            <TradeList rows={extremes.worst} sides={a.sides} day={day} money={signed} empty={a.empty} />
          </div>
        </div>
      </Card>

      {/* Дуги качества отдельной панелью: они отвечают на вопрос «это
          хорошо?» раньше, чем человек вспомнит, какой профит-фактор приличный,
          и прятать их за переключателем в таблице чисел значит не показывать
          вовсе. */}
      <Card
        title={a.gauges.title}
        hint={a.gauges.hint}
        icon={<GaugeIcon className="h-3.5 w-3.5" />}
        className="xl:col-span-3"
      >
        <div className="flex items-center justify-around gap-1" style={{ height: low }}>
          <Gauge
            fill={totals.winRate}
            value={`${Math.round(totals.winRate * 100)}%`}
            label={a.kpi.winRate}
            color="var(--pane-up)"
            size={Math.min(120, Math.max(78, low - 34))}
          />
          <Gauge
            fill={Math.min(1, (totals.profitFactor ?? 0) / PF_GOOD)}
            value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
            label={a.kpi.profitFactor}
            color="var(--pane-up)"
            size={Math.min(120, Math.max(78, low - 34))}
          />
          <Gauge
            fill={Math.min(1, totals.drawdownPct / DD_BAD)}
            value={`${Math.round(totals.drawdownPct * 100)}%`}
            label={a.kpi.drawdown}
            color="var(--pane-down)"
            size={Math.min(120, Math.max(78, low - 34))}
          />
        </div>
      </Card>

      {/* Лонг против шорта: две строки, по которым видно перекос. */}
      <Card
        title={a.sidesTitle.title}
        hint={a.sidesTitle.hint}
        icon={<Scale className="h-3.5 w-3.5" />}
        className="xl:col-span-2"
      >
        <div className="space-y-1.5" style={{ minHeight: low }}>
          {(["long", "short"] as const).map((key) => {
            const row = sides.find((one) => one.key === key);
            const count = row?.trades ?? 0;
            const share = totals.trades > 0 ? Math.round((count / totals.trades) * 100) : 0;
            const rate = count > 0 ? Math.round(((row?.wins ?? 0) / count) * 100) : 0;
            const up = (row?.pnl ?? 0) >= 0;
            return (
              <div key={key} className="rounded-lg bg-[var(--pane-hover)] px-2.5 py-2">
                <div className="flex items-baseline justify-between">
                  <span
                    className={`text-[11px] font-bold ${
                      key === "long" ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                    }`}
                  >
                    {a.sidesTitle[key]}
                  </span>
                  <span
                    className={`font-mono text-[15px] font-extrabold ${
                      up ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                    }`}
                  >
                    {signed(row?.pnl ?? 0)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--pane-bg)]">
                  <span
                    className="block h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${share}%`,
                      background: key === "long" ? "var(--pane-up)" : "var(--pane-down)",
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[9px] text-[var(--pane-muted)]">
                  <span>{a.tradesCount(count)}</span>
                  <span>
                    {share}% · {a.stats.rate(rate)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Результат по времени: один разрез, три способа разложить. */}
      <Card
        title={a.timing.title}
        hint={a.timing.hint}
        icon={<CalendarDays className="h-3.5 w-3.5" />}
        className="xl:col-span-4"
        right={
          <Pick
            value={cut}
            options={[
              { key: "weekday" as const, label: a.timing.weekday },
              { key: "hour" as const, label: a.timing.hour },
              { key: "session" as const, label: a.timing.session },
            ]}
            onPick={setCut}
          />
        }
      >
        <Bars items={time[cut]} height={low} format={signed} />
      </Card>

      {/* Серии и то, чем сделки кончались: дисциплина в трёх числах. */}
      <Card
        title={a.streaks.titleFull}
        hint={a.streaks.hint}
        icon={<Flame className="h-3.5 w-3.5" />}
        className="xl:col-span-3"
      >
        <div className="grid grid-cols-2 gap-1.5">
          <Tile
            label={a.streaks.best}
            value={String(series.best.length)}
            note={signed(series.best.pnl)}
            tone="up"
          />
          <Tile
            label={a.streaks.worst}
            value={String(series.worst.length)}
            note={signed(series.worst.pnl)}
            tone="down"
          />
          <Tile
            label={a.streaks.current}
            value={`${series.now.length > 0 ? "+" : ""}${series.now.length}`}
            note={signed(series.now.pnl)}
            tone={series.now.length >= 0 ? "up" : "down"}
          />
          {(["take", "stop", "manual"] as const).map((kind) => {
            const row = outcomes.find((one) => one.key === kind);
            const count = row?.trades ?? 0;
            const share = totals.trades > 0 ? Math.round((count / totals.trades) * 100) : 0;
            return (
              <Tile
                key={kind}
                label={a.outcomes[kind]}
                value={`${count}`}
                note={`${share}% · ${signed(row?.pnl ?? 0)}`}
                tone={kind === "take" ? "up" : kind === "stop" ? "down" : "plain"}
              />
            );
          })}
        </div>
      </Card>
      {/* Разбор по признаку: монеты, стороны, сессии, дни, часы, исходы. */}
      <Card
        title={a.table.title}
        hint={a.table.hint}
        icon={<ListOrdered className="h-3.5 w-3.5" />}
        className="xl:col-span-12"
        bodyClass="p-0"
        right={<CutTabs cut={table} onPick={setTable} a={a} />}
      >
        <BreakdownTable
          trades={trades}
          cut={table}
          symbol={symbol}
          onPick={onPick}
          money={money}
          signed={signed}
          height={deep}
          a={a}
        />
      </Card>

    </div>
  );
}

/** Строка «подпись - значение» в панели статистики. */
function Line({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--pane-border)] py-[3px] text-[11px] last:border-0">
      <span className="truncate text-[var(--pane-muted)]">{label}</span>
      <span className={`shrink-0 font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}

/** Плитка в нижнем ряду: число крупно, деньги под ним. */
function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "plain" | "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  return (
    <div className="rounded-lg bg-[var(--pane-hover)] px-2.5 py-1">
      <div className="truncate text-[9px] uppercase leading-tight tracking-wider text-[var(--pane-muted)]">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-mono text-[17px] font-extrabold leading-tight ${color}`}>{value}</span>
        <span className={`font-mono text-[11px] font-bold ${color}`}>{note}</span>
      </div>
    </div>
  );
}
