"use client";

// Расширенная аналитика: разбор торговли по журналу сделок.
//
// Два экрана. Первый отвечает на вопрос «как прошёл период»: показатели,
// кривая, разрезы долями. Второй - на вопрос «почему»: крупный график, полный
// список чисел, последние сделки строками и разрезы до монеты и часа. Выбор
// запоминается, чтобы раздел открывался тем экраном, которым его закрыли.
//
// Считаем в браузере из тех же сделок, что показывает журнал: своей ручки на
// сервере для этого не нужно, а запрос на каждое движение фильтра стоил бы
// дороже самой арифметики. Сделки берём за два периода сразу: второй нужен
// целиком, чтобы было с чем сравнивать числа первого.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Filter, Lock, RotateCcw } from "lucide-react";

import { summarize } from "@/lib/analytics/advanced";
import { useIntlLocale, useT } from "@/lib/i18n";
import { loadTrades, type JournalTrade } from "@/lib/journal";
import { useFitHeight } from "@/lib/useFitHeight";
import { useJournalExport } from "@/lib/journalExport";
import DetailView from "./views/DetailView";
import OverviewView from "./views/OverviewView";
import type { ViewProps } from "./views/types";

type Side = "all" | "long" | "short";
type View = "overview" | "detail";

const PERIODS = [30, 90, 365] as const;
const VIEWS: View[] = ["overview", "detail"];

const RENDER: Record<View, (props: ViewProps) => JSX.Element> = {
  overview: OverviewView,
  detail: DetailView,
};

/** Где запоминается выбранный вид. */
const VIEW_KEY = "nmnh.analytics.advancedView";

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

  const [view, setView] = useState<View>("overview");
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90);
  const [side, setSide] = useState<Side>("all");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [all, setAll] = useState<JournalTrade[] | null>(null);
  const fit = useFitHeight(420);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY) as View | null;
      if (saved && VIEWS.includes(saved)) setView(saved);
    } catch {
      // Хранилище закрыто настройками браузера - вид просто будет обычным.
    }
  }, []);

  function pickView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Не сохранилось - не беда, раздел работает и без памяти о выборе.
    }
  }

  useEffect(() => {
    let alive = true;
    setAll(null);
    // Два периода: второй целиком уходит в сравнение.
    loadTrades(days * 2)
      .then((res) => {
        if (alive) setAll(res?.trades ?? []);
      })
      .catch(() => alive && setAll([]));
    return () => {
      alive = false;
    };
  }, [days]);

  const edge = useMemo(() => Date.now() - days * 24 * 60 * 60 * 1000, [days]);

  const [trades, before] = useMemo(() => {
    const kept = (all ?? []).filter(
      (trade) =>
        (side === "all" || trade.side === side) && (symbol === null || trade.symbol === symbol),
    );
    const now: JournalTrade[] = [];
    const past: JournalTrade[] = [];
    for (const trade of kept) {
      (Date.parse(trade.closed_at) >= edge ? now : past).push(trade);
    }
    return [now, past];
  }, [all, side, symbol, edge]);

  const totals = useMemo(() => summarize(trades), [trades]);
  const prev = useMemo(() => summarize(before), [before]);

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
  const View = RENDER[view];

  return (
    <div className="space-y-2.5">
      {/* Разрез и вид. Всё ниже считается заново от того, что осталось после
          фильтров - в этом и смысл раздела. */}
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

        {/* Вид раздела: те же данные другой раскладкой. Отдельной строкой -
            это выбор надолго, а не часть разреза. */}
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-[var(--pane-border)] pt-2">
          <span className="text-[11px] font-semibold text-[var(--pane-text)]">{a.views.title}</span>
          {VIEWS.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => pickView(key)}
              title={a.views.hint[key]}
              className={`${CHIP} ${view === key ? CHIP_ON : CHIP_OFF} flex items-center gap-1.5`}
            >
              <span className="font-mono text-[10px] opacity-60">{`0${i + 1}`}</span>
              {a.views.name[key]}
            </button>
          ))}
          <span className="ml-auto truncate text-[10px] text-[var(--pane-muted)]">
            {a.views.hint[view]}
          </span>
        </div>
      </div>

      <div ref={fit.ref}>
        {loading ? (
          <div
            className="grid place-items-center rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[12px] text-[var(--pane-muted)]"
            style={{ height: fit.height }}
          >
            {a.loading}
          </div>
        ) : empty ? (
          <div
            className="grid place-items-center rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[12px] text-[var(--pane-muted)]"
            style={{ height: fit.height }}
          >
            {a.empty}
          </div>
        ) : (
          <View
            trades={trades}
            totals={totals}
            prev={prev}
            symbol={symbol}
            onPick={(key) => setSymbol(symbol === key ? null : key)}
            money={money}
            signed={signed}
            day={day}
            height={fit.wide ? fit.height : 0}
            a={a}
          />
        )}
      </div>
    </div>
  );
}
