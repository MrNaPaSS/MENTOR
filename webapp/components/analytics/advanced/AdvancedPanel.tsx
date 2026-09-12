"use client";

// Расширенная аналитика: разбор торговли по журналу сделок.
//
// То же, что уходит в выгрузку журнала, только живьём и на одном экране:
// кривая капитала, риск, разрезы по монетам, дням и часам. Раздел
// интерактивный - период, сторона и монета переключаются на месте, и все
// цифры пересчитываются от отфильтрованного набора, а не от всего журнала.
//
// Считается всё в браузере из тех же сделок, что показывает журнал: своей
// ручки на сервере для этого не нужно, а лишний запрос на каждый чих фильтра
// стоил бы дороже самой арифметики.

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BarChart2,
  CalendarDays,
  Clock,
  Coins,
  Filter,
  RotateCcw,
  Target,
  TrendingUp,
} from "lucide-react";

import { useIntlLocale, useT } from "@/lib/i18n";
import { loadTrades, type JournalTrade } from "@/lib/journal";
import {
  bySymbol,
  byHour,
  byOutcome,
  byWeekday,
  equityCurve,
  rDistribution,
  streaks,
  summarize,
} from "@/lib/analytics/advanced";
import { useFitHeight } from "@/lib/useFitHeight";
import Bars, { type BarItem } from "./Bars";
import EquityCurve from "./EquityCurve";

type Side = "all" | "long" | "short";

const PERIODS = [30, 90, 365] as const;
/** Сколько монет показываем в разрезе: остальные - в подписи «и ещё». */
const TOP_SYMBOLS = 6;

const CHIP =
  "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 ease-out";
const CHIP_ON = "border-accent-gold/50 bg-accent-gold/10 text-[var(--pane-gold)]";
const CHIP_OFF =
  "border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]";

export default function AdvancedPanel() {
  const t = useT();
  const numbers = useIntlLocale();
  const a = t.analytics.advanced;

  const [days, setDays] = useState<(typeof PERIODS)[number]>(90);
  const [side, setSide] = useState<Side>("all");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [all, setAll] = useState<JournalTrade[] | null>(null);
  const fit = useFitHeight(620);

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
  const outcomes = useMemo(() => byOutcome(trades), [trades]);
  const series = useMemo(() => streaks(trades), [trades]);
  const extremes = useMemo(() => {
    const sorted = [...trades].sort((x, y) => y.pnl - x.pnl);
    return { best: sorted.slice(0, 3), worst: sorted.slice(-3).reverse() };
  }, [trades]);

  function money(value: number): string {
    const size = Math.abs(value);
    const text = size.toLocaleString(numbers, {
      maximumFractionDigits: size >= 100 ? 0 : 2,
    });
    return `${value < 0 ? "-" : ""}$${text}`;
  }

  function day(ms: number): string {
    return new Date(ms).toLocaleDateString(numbers, { day: "numeric", month: "short" });
  }

  const filtered = side !== "all" || symbol !== null;
  const loading = all === null;
  const chart = Math.max(150, Math.round((fit.height - 300) * 0.52));
  const small = Math.max(92, Math.round((fit.height - 300) * 0.34));

  return (
    <div ref={fit.ref} className="space-y-2.5" style={fit.wide ? { minHeight: fit.height } : undefined}>
      {/* Фильтры: период, сторона, монета. Всё считается заново от того, что
          осталось после них - в этом и смысл раздела. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-2">
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
          <span className={`${CHIP} ${CHIP_ON}`}>{symbol.replace(/USDT$/, "")}</span>
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

        <span className="ml-auto text-[11px] text-[var(--pane-muted)]">
          {loading ? a.loading : a.tradesCount(totals.trades)}
        </span>
      </div>

      {/* Показатели: восемь чисел, по которым судят о торговле. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label={a.kpi.net} value={money(totals.net)} tone={totals.net >= 0 ? "up" : "down"} />
        <Kpi label={a.kpi.winRate} value={`${Math.round(totals.winRate * 100)}%`} />
        <Kpi
          label={a.kpi.profitFactor}
          value={totals.profitFactor === null ? "-" : totals.profitFactor.toFixed(2)}
          tone={totals.profitFactor !== null && totals.profitFactor >= 1 ? "up" : "plain"}
        />
        <Kpi
          label={a.kpi.avgR}
          value={totals.avgR === null ? "-" : `${totals.avgR >= 0 ? "+" : ""}${totals.avgR.toFixed(2)}R`}
          tone={totals.avgR !== null && totals.avgR >= 0 ? "up" : "down"}
          hint={a.kpi.avgRHint}
        />
        <Kpi
          label={a.kpi.drawdown}
          value={money(-totals.drawdown)}
          tone={totals.drawdown > 0 ? "down" : "plain"}
          hint={totals.drawdownPct > 0 ? `${Math.round(totals.drawdownPct * 100)}%` : undefined}
        />
        <Kpi label={a.kpi.fees} value={money(-totals.fees)} hint={a.kpi.feesHint} />
        <Kpi label={a.kpi.avgWin} value={money(totals.avgWin)} tone="up" hint={money(-totals.avgLoss)} />
        <Kpi
          label={a.kpi.hold}
          value={totals.holdMinutes === null ? "-" : a.minutes(Math.round(totals.holdMinutes))}
        />
      </div>

      <div className="grid gap-2.5 xl:grid-cols-12">
        {/* Кривая капитала - главный график раздела. */}
        <Card title={a.equity.title} hint={a.equity.hint} icon={<TrendingUp className="h-3.5 w-3.5" />} className="xl:col-span-8">
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

        {/* Распределение по риску: сколько сделок каких размеров. */}
        <Card title={a.risk.title} hint={a.risk.hint} icon={<BarChart2 className="h-3.5 w-3.5" />} className="xl:col-span-4">
          <Bars
            items={risks.map<BarItem>((bucket) => ({
              key: bucket.key,
              label: bucket.key,
              value: bucket.trades,
              note: a.tradesCount(bucket.trades),
            }))}
            height={chart}
            format={(value) => a.tradesCount(value)}
          />
        </Card>

        {/* Монеты: нажатие оставляет в разделе одну. */}
        <Card title={a.symbols.title} hint={a.symbols.hint} icon={<Coins className="h-3.5 w-3.5" />} className="xl:col-span-4">
          <div className="space-y-1" style={{ minHeight: small }}>
            {symbols.slice(0, TOP_SYMBOLS).map((row) => {
              const peak = Math.max(...symbols.map((s) => Math.abs(s.pnl)), 1);
              const up = row.pnl >= 0;
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setSymbol(symbol === row.key ? null : row.key)}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                    symbol === row.key ? "bg-[var(--pane-hover)]" : "hover:bg-[var(--pane-hover)]"
                  }`}
                >
                  <span className="w-14 shrink-0 truncate text-[11px] font-bold text-[var(--pane-text)]">
                    {row.key.replace(/USDT$/, "")}
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--pane-hover)]">
                    <span
                      className="block h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${(Math.abs(row.pnl) / peak) * 100}%`,
                        background: up ? "var(--pane-up)" : "var(--pane-down)",
                      }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] text-[var(--pane-muted)]">
                    {row.trades}
                  </span>
                  <span
                    className={`w-16 shrink-0 text-right font-mono text-[11px] font-bold ${
                      up ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                    }`}
                  >
                    {up ? "+" : ""}
                    {money(row.pnl)}
                  </span>
                </button>
              );
            })}
            {symbols.length === 0 && (
              <p className="py-6 text-center text-[11px] text-[var(--pane-muted)]">{a.empty}</p>
            )}
          </div>
        </Card>

        {/* Дни недели и часы: когда торгуется лучше. */}
        <Card title={a.week.title} hint={a.week.hint} icon={<CalendarDays className="h-3.5 w-3.5" />} className="xl:col-span-4">
          <Bars
            items={week.map<BarItem>((bucket, i) => ({
              key: bucket.key,
              label: a.weekdays[i],
              value: bucket.pnl,
              note: a.tradesCount(bucket.trades),
            }))}
            height={small}
            format={money}
          />
        </Card>

        <Card title={a.hours.title} hint={a.hours.hint} icon={<Clock className="h-3.5 w-3.5" />} className="xl:col-span-4">
          <Bars
            items={hours.map<BarItem>((bucket, i) => ({
              key: bucket.key,
              label: i % 3 === 0 ? String(i) : "",
              value: bucket.pnl,
              note: a.tradesCount(bucket.trades),
            }))}
            height={small}
            format={money}
          />
        </Card>

        {/* Чем кончались сделки и серии подряд. */}
        <Card title={a.outcomes.title} hint={a.outcomes.hint} icon={<Target className="h-3.5 w-3.5" />} className="xl:col-span-6">
          <div className="grid grid-cols-3 gap-2">
            {(["take", "stop", "manual"] as const).map((kind) => {
              const row = outcomes.find((one) => one.key === kind);
              const count = row?.trades ?? 0;
              const share = totals.trades > 0 ? Math.round((count / totals.trades) * 100) : 0;
              return (
                <div
                  key={kind}
                  className="rounded-lg border border-[var(--pane-border)] bg-[var(--pane-hover)] px-2 py-1.5"
                >
                  <div className="text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
                    {a.outcomes[kind]}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="font-mono text-[15px] font-bold text-[var(--pane-text)]">{count}</span>
                    <span className="text-[10px] text-[var(--pane-muted)]">{share}%</span>
                  </div>
                  <div
                    className={`font-mono text-[10px] font-semibold ${
                      (row?.pnl ?? 0) >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                    }`}
                  >
                    {(row?.pnl ?? 0) >= 0 ? "+" : ""}
                    {money(row?.pnl ?? 0)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--pane-muted)]">
            <span>
              {a.streaks.best}: <b className="text-[var(--pane-up)]">{series.bestWins}</b>
            </span>
            <span>
              {a.streaks.worst}: <b className="text-[var(--pane-down)]">{series.worstLosses}</b>
            </span>
            <span>
              {a.streaks.current}:{" "}
              <b className={series.current >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}>
                {series.current > 0 ? `+${series.current}` : series.current}
              </b>
            </span>
          </div>
        </Card>

        {/* Крайние сделки: на что смотреть в разборе. */}
        <Card title={a.extremes.title} hint={a.extremes.hint} icon={<Award className="h-3.5 w-3.5" />} className="xl:col-span-6">
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              [a.extremes.best, extremes.best],
              [a.extremes.worst, extremes.worst],
            ] as const).map(([label, rows]) => (
              <div key={label}>
                <div className="mb-1 text-[9px] uppercase tracking-wider text-[var(--pane-muted)]">
                  {label}
                </div>
                <div className="space-y-1">
                  {rows.map((row) => (
                    <div key={row.id} className="flex items-center gap-2 text-[10px]">
                      <span className="w-12 shrink-0 truncate font-bold text-[var(--pane-text)]">
                        {row.symbol.replace(/USDT$/, "")}
                      </span>
                      <span className="w-9 shrink-0 text-[var(--pane-muted)]">
                        {a.sides[row.side]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--pane-muted)]">
                        {day(Date.parse(row.closed_at))}
                      </span>
                      <span
                        className={`shrink-0 font-mono font-bold ${
                          row.pnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
                        }`}
                      >
                        {row.pnl >= 0 ? "+" : ""}
                        {money(row.pnl)}
                      </span>
                    </div>
                  ))}
                  {rows.length === 0 && (
                    <p className="text-[10px] text-[var(--pane-muted)]">{a.empty}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Плитка показателя: число крупно, подпись мелко. */
function Kpi({
  label,
  value,
  tone = "plain",
  hint,
}: {
  label: string;
  value: string;
  tone?: "plain" | "up" | "down";
  hint?: string;
}) {
  const color =
    tone === "up"
      ? "text-[var(--pane-up)]"
      : tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  return (
    <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-2.5 py-1.5">
      <div className="truncate text-[9px] font-semibold uppercase tracking-wider text-[var(--pane-muted)]">
        {label}
      </div>
      <div className={`font-mono text-[17px] font-extrabold leading-tight tabular-nums ${color}`}>
        {value}
      </div>
      {hint && <div className="truncate text-[9px] text-[var(--pane-muted)]">{hint}</div>}
    </div>
  );
}

/** Панель раздела: рамка, название и подпись - как у остальных панелей. */
function Card({
  title,
  hint,
  icon,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  /** Значок панели: раздел различают им раньше, чем прочитают название. */
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
        <h3 className="text-[12px] font-semibold text-[var(--pane-text)]">{title}</h3>
        {hint && <p className="truncate text-[10px] text-[var(--pane-muted)]">{hint}</p>}
      </header>
      <div className="p-2">{children}</div>
    </section>
  );
}
