"use client";

// Расширенная аналитика: разбор торговли по журналу сделок.
//
// То же, что уходит в выгрузку журнала, только живьём: из чего сложился итог,
// как распределились результаты по риску, когда торгуется лучше и чем всё
// кончилось. Раздел интерактивный - период, сторона и монета переключаются на
// месте, и каждое число пересчитывается от того, что осталось после фильтров.
//
// Считаем в браузере из тех же сделок, что показывает журнал: своей ручки на
// сервере для этого не нужно, а запрос на каждое движение фильтра стоил бы
// дороже самой арифметики.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award,
  BarChart3,
  CalendarDays,
  Clock,
  Coins,
  Download,
  Filter,
  Flame,
  Gauge,
  Lock,
  PieChart,
  RotateCcw,
  TrendingUp,
} from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { loadTrades, type JournalTrade } from "@/lib/journal";
import { useJournalExport } from "@/lib/journalExport";
import {
  bySymbol,
  byHour,
  byWeekday,
  equityCurve,
  rDistribution,
  rMultiple,
  streaks,
  summarize,
} from "@/lib/analytics/advanced";
import Bars, { type BarItem } from "./Bars";
import Donut, { DonutLegend, type Slice } from "./Donut";
import EquityCurve from "./EquityCurve";
import RBars from "./RBars";

type Side = "all" | "long" | "short";

const PERIODS = [30, 90, 365] as const;
/** Сколько монет показываем в разрезе. */
const TOP_SYMBOLS = 5;

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

const CHIP =
  "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ease-out";
const CHIP_ON = "border-accent-gold/50 bg-accent-gold/10 text-[var(--pane-gold)]";
const CHIP_OFF =
  "border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]";

export default function AdvancedPanel() {
  const t = useT();
  const numbers = useIntlLocale();
  const a = t.analytics.advanced;
  const exporting = useJournalExport();

  const [days, setDays] = useState<(typeof PERIODS)[number]>(90);
  const [side, setSide] = useState<Side>("all");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [all, setAll] = useState<JournalTrade[] | null>(null);

  useEffect(() => {
    let alive = true;
    setAll(null);
    loadTrades(days)
      .then((res) => {
        if (alive) setAll(res?.trades ?? []);
      })
      .catch(() => alive && setAll([]));
    return () => {
      alive = false;
    };
  }, [days]);

  const trades = useMemo(
    () =>
      (all ?? []).filter(
        (trade) =>
          (side === "all" || trade.side === side) && (symbol === null || trade.symbol === symbol),
      ),
    [all, side, symbol],
  );

  const totals = useMemo(() => summarize(trades), [trades]);
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const symbols = useMemo(() => bySymbol(trades), [trades]);
  const risks = useMemo(() => rDistribution(trades), [trades]);
  const week = useMemo(() => byWeekday(trades), [trades]);
  const hours = useMemo(() => byHour(trades), [trades]);
  const series = useMemo(() => streaks(trades), [trades]);
  const extremes = useMemo(() => {
    const won = trades.filter((trade) => trade.pnl > 0).sort((x, y) => y.pnl - x.pnl);
    const lost = trades.filter((trade) => trade.pnl < 0).sort((x, y) => x.pnl - y.pnl);
    return { best: won.slice(0, 3), worst: lost.slice(0, 3) };
  }, [trades]);

  function money(value: number): string {
    const size = Math.abs(value);
    const text = size.toLocaleString(numbers, { maximumFractionDigits: size >= 100 ? 0 : 2 });
    return `${value < 0 ? "-" : ""}$${text}`;
  }

  function signed(value: number): string {
    return `${value > 0 ? "+" : ""}${money(value)}`;
  }

  function day(ms: number): string {
    return new Date(ms).toLocaleDateString(numbers, { day: "numeric", month: "short" });
  }

  const filtered = side !== "all" || symbol !== null;
  const loading = all === null;
  const empty = !loading && totals.trades === 0;

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
    <div className="space-y-2.5">
      {/* Разрез: период, сторона, монета. Всё ниже считается заново от того,
          что осталось после фильтров - в этом и смысл раздела. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--pane-text)]">
          <Filter className="h-3.5 w-3.5 text-[var(--pane-gold)]" />
          {a.filters}
        </span>

        <div className="flex gap-1.5">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value)}
              className={`${CHIP} ${days === value ? CHIP_ON : CHIP_OFF}`}
            >
              {a.days(value)}
            </button>
          ))}
        </div>

        <span className="h-4 w-px bg-[var(--pane-border)]" />

        <div className="flex gap-1.5">
          {(["all", "long", "short"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSide(value)}
              className={`${CHIP} ${side === value ? CHIP_ON : CHIP_OFF}`}
            >
              {a.sides[value]}
            </button>
          ))}
        </div>

        {symbol && (
          <button type="button" onClick={() => setSymbol(null)} className={`${CHIP} ${CHIP_ON}`}>
            {symbol.replace(/USDT$/, "")} ✕
          </button>
        )}

        {filtered && (
          <button
            type="button"
            onClick={() => {
              setSide("all");
              setSymbol(null);
            }}
            className="flex items-center gap-1 text-[11px] text-[var(--pane-muted)] transition-colors hover:text-[var(--pane-text)]"
          >
            <RotateCcw className="h-3 w-3" />
            {a.reset}
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-[var(--pane-muted)]">
            {loading ? a.loading : a.tradesCount(totals.trades)}
          </span>

          {/* Тот же отчёт, что в журнале терминала: инструмент маркета, три
              выгрузки в месяц. Не куплен - замок ведёт в «Инструменты». */}
          {exporting.loaded &&
            (exporting.owned ? (
              <button
                type="button"
                onClick={() => exporting.run(symbol ?? undefined)}
                disabled={exporting.busy || exporting.spent}
                title={
                  exporting.quota
                    ? exporting.spent
                      ? t.journal.exportSpent(exporting.resetDay)
                      : t.journal.exportLeftTitle(
                          exporting.quota.left,
                          exporting.quota.limit,
                          exporting.resetDay,
                        )
                    : t.journal.exportCsv
                }
                className={`${CHIP} ${CHIP_OFF} flex items-center gap-1.5 disabled:opacity-50`}
              >
                <Download className="h-3.5 w-3.5" />
                {a.export}
                {exporting.quota && (
                  <span className="font-mono text-[10px] tabular-nums opacity-70">
                    {exporting.quota.left}/{exporting.quota.limit}
                  </span>
                )}
              </button>
            ) : (
              <Link
                href="/app/shop?cat=tools"
                title={t.journal.exportLocked}
                className={`${CHIP} ${CHIP_OFF} flex items-center gap-1.5`}
              >
                <Lock className="h-3 w-3" />
                {a.export}
              </Link>
            ))}
        </div>

        {exporting.error && (
          <span className="w-full text-[10px] text-[var(--pane-down)]">{exporting.error}</span>
        )}
      </div>

      {empty ? (
        <div className="grid place-items-center rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] py-20 text-[12px] text-[var(--pane-muted)]">
          {a.empty}
        </div>
      ) : (
        <div className="grid gap-2.5 xl:grid-cols-12">
          {/* Итог: кольцо в середине панели, доли словами рядом. */}
          <Card
            title={a.total.title}
            hint={a.total.hint}
            icon={<PieChart className="h-3.5 w-3.5" />}
            className="xl:col-span-4"
          >
            <div className="flex items-center gap-4">
              <Donut
                slices={totalSlices}
                size={132}
                thickness={16}
                center={
                  <div>
                    <div
                      className={`font-mono text-[19px] font-extrabold leading-none ${
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
                <DonutLegend slices={totalSlices} showShare={false} />
                <div className="mt-2 flex items-baseline justify-between border-t border-[var(--pane-border)] pt-2 text-[11px]">
                  <span className="text-[var(--pane-muted)]">{a.total.all}</span>
                  <span className="font-mono font-bold text-[var(--pane-text)]">
                    {totals.trades}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Распределение по R: форма торговли одним взглядом. */}
          <Card
            title={a.risk.title}
            hint={a.risk.hint}
            icon={<BarChart3 className="h-3.5 w-3.5" />}
            className="xl:col-span-5"
          >
            <RBars buckets={risks} height={138} money={money} count={a.tradesCount} />
          </Card>

          {/* Дни недели: доли сделок кольцом, деньги - в легенде. */}
          <Card
            title={a.week.title}
            hint={a.week.hint}
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            className="xl:col-span-3"
          >
            <div className="flex items-center gap-3">
              <Donut slices={weekSlices} size={104} thickness={13} />
              <DonutLegend slices={weekSlices} className="flex-1" />
            </div>
          </Card>

          {/* Кривая капитала: та же, что в отчёте, только с подсказкой. */}
          <Card
            title={a.equity.title}
            hint={a.equity.hint}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            className="xl:col-span-7"
          >
            <EquityCurve
              points={curve}
              height={188}
              money={money}
              day={day}
              labelTrade={a.equity.account}
              labelResult={a.equity.result}
              empty={a.empty}
            />
          </Card>

          {/* Показатели: восемь чисел, по которым судят о торговле. */}
          <Card
            title={a.metrics.title}
            hint={a.metrics.hint}
            icon={<Gauge className="h-3.5 w-3.5" />}
            className="xl:col-span-5"
          >
            <div className="grid grid-cols-2 gap-1.5">
              <Metric
                label={a.kpi.winRate}
                value={`${Math.round(totals.winRate * 100)}%`}
                note={`${totals.wins} / ${totals.wins + totals.losses}`}
                tone={totals.winRate >= 0.5 ? "up" : "plain"}
              />
              <Metric
                label={a.kpi.profitFactor}
                value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
                note={a.metrics.profitFactorNote}
                tone={totals.profitFactor !== null && totals.profitFactor >= 1 ? "up" : "down"}
              />
              <Metric
                label={a.kpi.avgR}
                value={
                  totals.avgR === null
                    ? "-"
                    : `${totals.avgR >= 0 ? "+" : ""}${totals.avgR.toFixed(2)}R`
                }
                note={a.kpi.avgRHint}
                tone={totals.avgR !== null && totals.avgR >= 0 ? "up" : "down"}
              />
              <Metric
                label={a.kpi.drawdown}
                value={money(-totals.drawdown)}
                note={
                  totals.drawdownPct > 0
                    ? `${Math.round(totals.drawdownPct * 100)}%`
                    : a.metrics.none
                }
                tone={totals.drawdown > 0 ? "down" : "plain"}
              />
              <Metric
                label={a.kpi.avgWin}
                value={money(totals.avgWin)}
                note={a.metrics.avgLoss(money(-totals.avgLoss))}
                tone="up"
              />
              <Metric
                label={a.metrics.expectancy}
                value={signed(totals.expectancy)}
                note={a.metrics.expectancyNote}
                tone={totals.expectancy >= 0 ? "up" : "down"}
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
                label={a.kpi.hold}
                value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
                note={a.metrics.holdNote}
              />
            </div>
          </Card>

          {/* Края: с них начинают разбор. */}
          <Card
            title={a.extremes.best}
            hint={a.extremes.hint}
            icon={<Award className="h-3.5 w-3.5" />}
            className="xl:col-span-4"
          >
            <TradeList rows={extremes.best} sides={a.sides} day={day} signed={signed} empty={a.empty} />
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
              signed={signed}
              empty={a.empty}
            />
          </Card>

          {/* Серии: длина подряд и деньги, которые она принесла. */}
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

          {/* Монеты: нажатие оставляет в разделе одну. */}
          <Card
            title={a.symbols.title}
            hint={a.symbols.hint}
            icon={<Coins className="h-3.5 w-3.5" />}
            className="xl:col-span-4"
          >
            <SymbolList
              rows={symbols.slice(0, TOP_SYMBOLS)}
              picked={symbol}
              onPick={(key) => setSymbol(symbol === key ? null : key)}
              signed={signed}
              empty={a.empty}
            />
          </Card>

          <Card
            title={a.hours.title}
            hint={a.hours.hint}
            icon={<Clock className="h-3.5 w-3.5" />}
            className="xl:col-span-8"
          >
            <Bars
              items={hours.map<BarItem>((bucket, i) => ({
                key: bucket.key,
                label: i % 3 === 0 ? String(i) : "",
                value: bucket.pnl,
                note: `${i}:00 · ${a.tradesCount(bucket.trades)}`,
              }))}
              height={96}
              format={signed}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

/** Число показателя: подпись сверху, значение крупно, пояснение снизу. */
function Metric({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";

  return (
    <div className="rounded-lg bg-[var(--pane-hover)] px-2 py-1">
      <div className="truncate text-[9px] uppercase leading-tight tracking-wider text-[var(--pane-muted)]">
        {label}
      </div>
      <div className={`font-mono text-[15px] font-extrabold leading-tight tabular-nums ${color}`}>
        {value}
      </div>
      {note && <div className="truncate text-[9px] leading-tight text-[var(--pane-muted)]">{note}</div>}
    </div>
  );
}

/** Строка серии: длина крупно, деньги рядом. */
function StreakRow({
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

/** Список сделок: монета, сторона, R, дата и результат. */
function TradeList({
  rows,
  sides,
  day,
  signed,
  empty,
}: {
  rows: readonly JournalTrade[];
  sides: Record<"long" | "short", string>;
  day: (ms: number) => string;
  signed: (value: number) => string;
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
              {signed(row.pnl)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Монеты: полоса доли, число сделок, винрейт и итог. */
function SymbolList({
  rows,
  picked,
  onPick,
  signed,
  empty,
}: {
  rows: readonly { key: string; trades: number; pnl: number; wins: number }[];
  picked: string | null;
  onPick: (key: string) => void;
  signed: (value: number) => string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-5 text-center text-[11px] text-[var(--pane-muted)]">{empty}</p>;
  }
  const peak = Math.max(...rows.map((row) => Math.abs(row.pnl)), 1);

  return (
    <div className="space-y-0.5">
      {rows.map((row) => {
        const up = row.pnl >= 0;
        const rate = row.trades > 0 ? Math.round((row.wins / row.trades) * 100) : 0;
        return (
          <button
            key={row.key}
            type="button"
            onClick={() => onPick(row.key)}
            className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors ${
              picked === row.key ? "bg-[var(--pane-hover)]" : "hover:bg-[var(--pane-hover)]"
            }`}
          >
            <span className="w-12 shrink-0 truncate text-[11px] font-bold text-[var(--pane-text)]">
              {row.key.replace(/USDT$/, "")}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--pane-hover)]">
              <span
                className="block h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${(Math.abs(row.pnl) / peak) * 100}%`,
                  background: up ? "var(--pane-up)" : "var(--pane-down)",
                }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[10px] text-[var(--pane-muted)]">
              {row.trades} · {rate}%
            </span>
            <span
              className={`w-16 shrink-0 text-right font-mono text-[11px] font-bold ${
                up ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
              }`}
            >
              {signed(row.pnl)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Панель раздела: рамка, значок, название и подпись. */
function Card({
  title,
  hint,
  icon,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  /** Значок панели: её различают им раньше, чем прочитают название. */
  icon: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] ${className}`}
    >
      <header className="flex items-baseline gap-2 border-b border-[var(--pane-border)] px-3 py-1.5">
        <span className="self-center text-[var(--pane-gold)]">{icon}</span>
        <h3 className="shrink-0 text-[12px] font-semibold text-[var(--pane-text)]">{title}</h3>
        {hint && <p className="truncate text-[10px] text-[var(--pane-muted)]">{hint}</p>}
      </header>
      <div className="p-2.5">{children}</div>
    </section>
  );
}
