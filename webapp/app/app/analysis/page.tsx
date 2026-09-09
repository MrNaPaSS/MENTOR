"use client";

import { useEffect, useState } from "react";
import { api, API_URL, BroadcastItem } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { ExternalLink, TrendingUp, ImageIcon, Radio, Lock, CandlestickChart } from "lucide-react";
import SignalsFeed from "@/components/signals/SignalsFeed";
import ChartOverlay from "@/components/market/ChartOverlay";
import { intlLocale, useLocale, useT, type Dict } from "@/lib/i18n";
import { CHIP, CHIP_OFF, CHIP_ON, PaneHead, PaneScope } from "@/components/app/Pane";

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
    <article className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">

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
            style={{ maxHeight: 260 }}
          />
          {/* Градиент-оверлей снизу */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--pane-bg)] to-transparent" />

          {/* Бейджи поверх изображения */}
          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--pane-bg)]/80 px-2 py-0.5 text-[10px] font-semibold text-[var(--pane-text)] backdrop-blur-sm">
              <TrendingUp className="h-3 w-3 text-[var(--pane-accent)]" />
              {t.signals.analysisBadge}
            </span>
            {item.audience !== "all" && (
              <span className="rounded-full bg-[var(--pane-gold)]/20 px-2.5 py-1 text-[10px] font-semibold text-[var(--pane-gold)] backdrop-blur-sm border border-[var(--pane-gold-soft)]">
                {audience[item.audience] ?? item.audience}
              </span>
            )}
          </div>

          {/* Кнопка открыть - появляется при hover */}
          <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-[var(--pane-bg)]/70 px-3 py-1 text-[11px] text-[var(--pane-text-2)] opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            <ExternalLink className="h-3 w-3" />
            TradingView
          </div>

          {/* Дата поверх нижнего градиента */}
          <div className="absolute bottom-2 left-2 text-[10px] text-[var(--pane-muted)]">
            {fmtDate(item.created_at, numbers)}
          </div>
        </a>
      ) : (
        /* Шапка без графика */
        <div className="flex items-center justify-between px-3 pt-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--pane-accent-faint)]">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--pane-accent)]" />
            </span>
            <span className="text-sm font-semibold text-[var(--pane-text)]">{t.signals.analysisBadge}</span>
            {item.audience !== "all" && (
              <span className="rounded-md border border-[var(--pane-gold-soft)] bg-[var(--pane-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--pane-gold)]">
                {audience[item.audience] ?? item.audience}
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--pane-muted)]">{relativeDate(item.created_at, t)}</span>
        </div>
      )}

      {/* ── Текст ─────────────────────────────────────────────── */}
      {item.text && (
        <div className="px-3 py-2.5">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--pane-text-2)]">
            {item.text}
          </p>
        </div>
      )}

      {/* ── Футер: дата + кнопка «Открыть график» ───────────── */}
      {(!img || item.symbol) && (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--pane-border)] px-3 py-2">
          <span className="text-[11px] text-[var(--pane-muted)]">{!img ? fmtDate(item.created_at, numbers) : ""}</span>
          {item.symbol && (
            <button
              onClick={() => setChartOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--pane-hover)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--pane-accent)] ring-1 ring-inset ring-[var(--pane-accent-soft)] transition hover:bg-[var(--pane-accent-faint)] hover:ring-[var(--pane-accent-soft)]"
            >
              <CandlestickChart className="h-3.5 w-3.5" />
              {t.signals.openChart}
              <span className="font-mono text-[11px] text-[var(--pane-muted)]">{item.symbol}</span>
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
        <div className="space-y-3 xl:max-w-2xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
              <div className="skeleton h-48 w-full" />
              <div className="space-y-2 p-3">
                <div className="skeleton h-4 w-3/4 rounded-lg" />
                <div className="skeleton h-4 w-1/2 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] grid place-items-center py-16 text-center text-[var(--pane-muted)]">
          <TrendingUp className="mb-3 h-10 w-10 opacity-20" />
          <p className="font-medium">{t.signals.emptyAnalysis}</p>
          <p className="mt-1 text-sm opacity-60">{t.signals.emptyAnalysisHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
    <PaneScope className="space-y-3">
      {/* Название, строка о разделе и вкладки - одной строкой: заголовок в два
          сантиметра высотой ничего не добавляет тому, кто сам сюда нажал. */}
      <PaneHead
        title={t.signals.analysisTitle}
        hint={tab === "analysis" ? t.signals.analysisSubtitle : t.signals.signalsSubtitle}
      >
        <button
          onClick={() => setTab("analysis")}
          className={`flex items-center gap-1.5 ${CHIP} ${
            tab === "analysis" ? CHIP_ON : CHIP_OFF
          }`}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          {t.signals.tabAnalysis}
        </button>

        {/* Сигналы открыты, только пока есть хоть один живой. */}
        <button
          onClick={() => !signalsLocked && setTab("signals")}
          disabled={signalsLocked}
          title={signalsLocked ? t.signals.noActiveSignals : undefined}
          className={`flex items-center gap-1.5 ${CHIP} ${
            signalsLocked
              ? "cursor-not-allowed text-[var(--pane-muted)]/40"
              : tab === "signals"
                ? CHIP_ON
                : CHIP_OFF
          }`}
        >
          {signalsLocked ? <Lock className="h-3 w-3" /> : <Radio className="h-3.5 w-3.5" />}
          {t.signals.tabSignals}
          {!signalsLocked && activeCount !== null && activeCount > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--pane-accent-soft)] px-1 text-[10px] font-bold text-[var(--pane-accent)]">
              {activeCount}
            </span>
          )}
        </button>
      </PaneHead>

      {tab === "analysis" ? <AnalysisFeed /> : <SignalsFeed />}
    </PaneScope>
  );
}
