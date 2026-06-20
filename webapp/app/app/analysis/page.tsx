"use client";

import { useEffect, useState } from "react";
import { api, API_URL, BroadcastItem } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { ExternalLink, TrendingUp, ImageIcon, Radio } from "lucide-react";
import SignalsFeed from "@/components/signals/SignalsFeed";

type Tab = "analysis" | "signals";

function chartImgUrl(url: string): string | null {
  if (url.startsWith("/uploads/")) return `${API_URL}${url}`;
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "только что";
  if (mins  < 60) return `${mins} мин. назад`;
  if (hours < 24) return `${hours} ч. назад`;
  if (days  <  2) return "вчера";
  return `${days} дн. назад`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("ru", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const AUDIENCE_LABEL: Record<string, string> = {
  moderate: "Умеренным",
  turbo:    "Турбо",
};

function BroadcastCard({ item }: { item: BroadcastItem }) {
  const img = item.chart_url ? chartImgUrl(item.chart_url) : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.07] bg-bg-panel">

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
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
              <TrendingUp className="h-3 w-3 text-accent-cyan" />
              Анализ
            </span>
            {item.audience !== "all" && (
              <span className="rounded-full bg-accent-gold/20 px-2.5 py-1 text-[10px] font-semibold text-accent-gold backdrop-blur-sm border border-accent-gold/30">
                {AUDIENCE_LABEL[item.audience] ?? item.audience}
              </span>
            )}
          </div>

          {/* Кнопка открыть - появляется при hover */}
          <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/70 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            <ExternalLink className="h-3 w-3" />
            TradingView
          </div>

          {/* Дата поверх нижнего градиента */}
          <div className="absolute bottom-3 left-4 text-[11px] text-white/50">
            {fmtDate(item.created_at)}
          </div>
        </a>
      ) : (
        /* Шапка без графика */
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-cyan/10">
              <TrendingUp className="h-3.5 w-3.5 text-accent-cyan" />
            </span>
            <span className="text-sm font-semibold text-white">Анализ</span>
            {item.audience !== "all" && (
              <span className="rounded-md border border-accent-gold/30 bg-accent-gold/10 px-2 py-0.5 text-[10px] font-semibold text-accent-gold">
                {AUDIENCE_LABEL[item.audience] ?? item.audience}
              </span>
            )}
          </div>
          <span className="text-xs text-text-muted">{relativeDate(item.created_at)}</span>
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

      {/* ── Нижняя линия с датой (только если нет графика) ───── */}
      {!img && (
        <div className="border-t border-white/[0.05] px-5 py-3">
          <span className="text-[11px] text-text-muted">{fmtDate(item.created_at)}</span>
        </div>
      )}
    </article>
  );
}

function AnalysisFeed() {
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
            <div key={i} className="overflow-hidden rounded-2xl border border-white/[0.07] bg-bg-panel">
              <div className="skeleton h-64 w-full" />
              <div className="space-y-2 p-5">
                <div className="skeleton h-4 w-3/4 rounded-lg" />
                <div className="skeleton h-4 w-1/2 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-bg-panel grid place-items-center py-24 text-center text-text-muted">
          <TrendingUp className="mb-3 h-10 w-10 opacity-20" />
          <p className="font-medium">Анализов пока нет</p>
          <p className="mt-1 text-sm opacity-60">Ментор ещё не опубликовал анализ</p>
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

const TABS: { key: Tab; label: string; icon: typeof ImageIcon }[] = [
  { key: "analysis", label: "Анализы", icon: ImageIcon },
  { key: "signals",  label: "Сигналы", icon: Radio },
];

export default function AnalysisPage() {
  const [tab, setTab] = useState<Tab>("analysis");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Анализы</h1>
        <p className="text-sm text-text-muted">
          {tab === "analysis" ? "Разборы рынка от ментора" : "Сигналы, рассчитанные под ваш депозит"}
        </p>
      </div>

      {/* Переключатель вкладок */}
      <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1 w-fit">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                active ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "analysis" ? <AnalysisFeed /> : <SignalsFeed />}
    </div>
  );
}
