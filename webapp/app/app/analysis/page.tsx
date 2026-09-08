"use client";

import { useEffect, useState } from "react";
import { api, API_URL, BroadcastItem } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { ExternalLink, TrendingUp, ImageIcon, Radio, Lock, CandlestickChart } from "lucide-react";
import SignalsFeed from "@/components/signals/SignalsFeed";
import ChartOverlay from "@/components/market/ChartOverlay";
import { intlLocale, useLocale, useT, type Dict } from "@/lib/i18n";

type Tab = "analysis" | "signals";

function chartImgUrl(url: string): string | null {
  if (url.startsWith("/uploads/")) return `${API_URL}${url}`;
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

function relativeDate(iso: string, t: Dict): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return t.format.ago.now;
  if (mins  < 60) return t.format.ago.minutes(mins);
  if (hours < 24) return t.format.ago.hours(hours);
  if (days  <  2) return t.format.ago.yesterday;
  return t.format.ago.days(days);
}

function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function BroadcastCard({ item }: { item: BroadcastItem }) {
  const t = useT();
  const numbers = intlLocale(useLocale());
  const audience = t.signals.audience as Record<string, string>;
  const img = item.chart_url ? chartImgUrl(item.chart_url) : null;
  const [chartOpen, setChartOpen] = useState(false);

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-bg-panel">

      {/* ── График (hero) ─────────────────────────────────────── */}
      {img ? (
        <a
          href={item.chart_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block"
        >
          <img
            src={img}
            alt="chart"
            className="w-full object-cover"
            style={{ maxHeight: 340 }}
          />
          {/* Градиент-оверлей снизу */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-bg-panel to-transparent" />

          {/* Бейджи поверх изображения */}
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-bg-deep/60 px-3 py-1 text-[11px] font-semibold text-text-primary backdrop-blur-sm">
              <TrendingUp className="h-3 w-3 text-accent-cyan" />
              {t.signals.analysisBadge}
            </span>
            {item.audience !== "all" && (
              <span className="rounded-full bg-accent-gold/20 px-2.5 py-1 text-[10px] font-semibold text-accent-gold backdrop-blur-sm border border-accent-gold/30">
                {audience[item.audience] ?? item.audience}
              </span>
            )}
          </div>

          {/* Кнопка открыть - появляется при hover */}
          <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-bg-deep/60 px-3 py-1 text-[11px] text-text-primary/70 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            <ExternalLink className="h-3 w-3" />
            TradingView
          </div>

          {/* Дата поверх нижнего градиента */}
          <div className="absolute bottom-3 left-4 text-[11px] text-text-primary/50">
            {fmtDate(item.created_at, numbers)}
          </div>
        </a>
      ) : (
        /* Шапка без графика */
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-cyan/10">
              <TrendingUp className="h-3.5 w-3.5 text-accent-cyan" />
            </span>
            <span className="text-sm font-semibold text-text-primary">{t.signals.analysisBadge}</span>
            {item.audience !== "all" && (
              <span className="rounded-md border border-accent-gold/30 bg-accent-gold/10 px-2 py-0.5 text-[10px] font-semibold text-accent-gold">
                {audience[item.audience] ?? item.audience}
              </span>
            )}
          </div>
          <span className="text-xs text-text-muted">{relativeDate(item.created_at, t)}</span>
        </div>
      )}

      {/* ── Текст ─────────────────────────────────────────────── */}
      {item.text && (
        <div className="px-5 py-4">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text-secondary">
            {item.text}
          </p>
        </div>
      )}

      {/* ── Футер: дата + кнопка «Открыть график» ───────────── */}
      {(!img || item.symbol) && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-[11px] text-text-muted">{!img ? fmtDate(item.created_at, numbers) : ""}</span>
          {item.symbol && (
            <button
              onClick={() => setChartOpen(true)}
              className="flex items-center gap-1.5 rounded-xl bg-bg-panel/60 px-3.5 py-2 text-[12px] font-semibold text-accent-cyan ring-1 ring-inset ring-accent-cyan/20 transition hover:bg-accent-cyan/[0.1] hover:ring-accent-cyan/40"
            >
              <CandlestickChart className="h-3.5 w-3.5" />
              {t.signals.openChart}
              <span className="font-mono text-[11px] text-text-primary/50">{item.symbol}</span>
            </button>
          )}
        </div>
      )}

      {chartOpen && item.symbol && (
        <ChartOverlay symbol={item.symbol} onClose={() => setChartOpen(false)} />
      )}
    </article>
  );
}

function AnalysisFeed() {
  const t = useT();
  const [items,  setItems]  = useState<BroadcastItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.broadcasts(token)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <>
      {!loaded ? (
        <div className="space-y-4 xl:max-w-2xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-bg-panel">
              <div className="skeleton h-64 w-full" />
              <div className="space-y-2 p-5">
                <div className="skeleton h-4 w-3/4 rounded-lg" />
                <div className="skeleton h-4 w-1/2 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-panel grid place-items-center py-24 text-center text-text-muted">
          <TrendingUp className="mb-3 h-10 w-10 opacity-20" />
          <p className="font-medium">{t.signals.emptyAnalysis}</p>
          <p className="mt-1 text-sm opacity-60">{t.signals.emptyAnalysisHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((item) => (
            <BroadcastCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

export default function AnalysisPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("analysis");
  // null — ещё проверяем, число — количество активных сигналов
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const signalsLocked = activeCount === 0;

  useEffect(() => {
    api.activeSignals()
      .then((list) => setActiveCount(list.length))
      .catch(() => setActiveCount(0));
  }, []);

  // Если активные сигналы пропали, пока пользователь был на их вкладке — вернём на анализы
  useEffect(() => {
    if (signalsLocked && tab === "signals") setTab("analysis");
  }, [signalsLocked, tab]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-text-primary">{t.signals.analysisTitle}</h1>
        <p className="text-sm text-text-muted">
          {tab === "analysis" ? t.signals.analysisSubtitle : t.signals.signalsSubtitle}
        </p>
      </div>

      {/* Переключатель вкладок */}
      <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1 w-fit">
        {/* Анализы */}
        <button
          onClick={() => setTab("analysis")}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
            tab === "analysis" ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-text-primary"
          }`}
        >
          <ImageIcon className="h-4 w-4" />
          {t.signals.tabAnalysis}
        </button>

        {/* Сигналы — активны только при наличии активного сигнала */}
        <button
          onClick={() => !signalsLocked && setTab("signals")}
          disabled={signalsLocked}
          title={signalsLocked ? t.signals.noActiveSignals : undefined}
          className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
            signalsLocked
              ? "cursor-not-allowed text-text-muted/40"
              : tab === "signals"
              ? "bg-accent-cyan/15 text-accent-cyan"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          {signalsLocked ? <Lock className="h-3.5 w-3.5" /> : <Radio className="h-4 w-4" />}
          {t.signals.tabSignals}
          {!signalsLocked && activeCount !== null && activeCount > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-cyan/20 px-1 text-[10px] font-bold text-accent-cyan">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {tab === "analysis" ? <AnalysisFeed /> : <SignalsFeed />}
    </div>
  );
}
