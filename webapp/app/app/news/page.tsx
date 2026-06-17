"use client";

import { useState, useEffect, useRef } from "react";

// ─── Каналы с настоящими YouTube Channel ID (не handle!) ───────────────────
// Важно: каналы должны разрешать embedding. CNBC и Al Jazeera - блокируют.
const CHANNELS = [
  {
    id: "bloomberg",
    name: "Bloomberg Markets",
    category: "Finance 🇺🇸",
    channelId: "UCIALMKvObZNtJ6AmdCLP7Lg",
    color: "#1a56db",
  },
  {
    id: "dw",
    name: "DW News",
    category: "World 🇩🇪",
    channelId: "UCknLrEdhRCp1aegoMqRaCZg",
    color: "#cc0000",
  },
  {
    id: "france24",
    name: "France 24 English",
    category: "World 🇫🇷",
    channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg",
    color: "#0050a0",
  },
  {
    id: "skynews",
    name: "Sky News",
    category: "World 🇬🇧",
    channelId: "UCoMdktPbSTixAyNGwb-UYkQ",
    color: "#cc2200",
  },
  {
    id: "euronews",
    name: "Euronews English",
    category: "World 🇪🇺",
    channelId: "UCg2JZBwgSYMaFQFm26LQZEQ",
    color: "#ff6600",
  },
  {
    id: "wion",
    name: "WION",
    category: "World 🌏",
    channelId: "UCbRNB7d5AKF1HxlHFVkdSqw",
    color: "#e00000",
  },
];

type GridSize = 1 | 2 | 4 | 6;

// ─── Компонент одного стрима ────────────────────────────────────────────────
function LiveStream({ channelId, name, muted = true }: { channelId: string; name: string; muted?: boolean }) {
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const src =
    `https://www.youtube.com/embed/live_stream` +
    `?channel=${channelId}` +
    `&autoplay=1` +
    `${muted ? "&mute=1" : ""}` +
    `&controls=1&rel=0&modestbranding=1&iv_load_policy=3`;

  return (
    <div className="relative h-full w-full bg-black">
      {/* Скелетон пока грузится */}
      {!loaded && !offline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan" />
          <span className="text-xs text-text-muted">Загрузка эфира...</span>
        </div>
      )}

      {/* Оффлайн-заглушка */}
      {offline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
          <span className="text-3xl">📡</span>
          <p className="text-sm font-semibold text-white">{name}</p>
          <p className="text-xs text-text-muted">Канал не в эфире прямо сейчас</p>
          <a
            href={`https://www.youtube.com/@${channelId}/live`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500"
          >
            ▶ Открыть на YouTube
          </a>
        </div>
      )}

      {!offline && (
        <iframe
          key={channelId}
          src={src}
          title={name}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          onLoad={() => setLoaded(true)}
          onError={() => setOffline(true)}
        />
      )}
    </div>
  );
}

// ─── TradingView лента новостей ──────────────────────────────────────────────
function TradingViewNews() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    container.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "tradingview-widget-container__widget";
    wrap.style.cssText = "height:100%;width:100%;";
    container.appendChild(wrap);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-timeline.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      feedMode: "all_symbols",
      isTransparent: true,
      displayMode: "regular",
      width: "100%",
      height: "100%",
      colorTheme: "dark",
      locale: "ru",
    });
    container.appendChild(script);
    return () => { if (container) container.innerHTML = ""; };
  }, []);
  return <div ref={ref} className="tradingview-widget-container h-full w-full" />;
}

// ─── Крипто-новости через RSS прокси ────────────────────────────────────────
interface NewsItem { title: string; url: string; source: string; publishedAt: string; body: string; }

function CryptoNewsFeed() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // CryptoCompare public API (бесплатно, без ключа)
    fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.Data?.length) {
          setNews(data.Data.slice(0, 30).map((n: any) => ({
            title: n.title,
            url: n.url,
            source: n.source_info?.name || n.source,
            publishedAt: new Date(n.published_on * 1000).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
            body: n.body?.slice(0, 120) + "...",
          })));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex h-40 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan" />
    </div>
  );

  return (
    <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 560 }}>
      {news.map((n, i) => (
        <a
          key={i}
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex gap-3 rounded-xl border border-border/40 bg-bg-panel/40 p-3 transition hover:border-accent-cyan/30 hover:bg-accent-cyan/5"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white leading-snug line-clamp-2">{n.title}</p>
            <p className="mt-0.5 text-[11px] text-text-muted line-clamp-2">{n.body}</p>
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-text-muted">
              <span className="font-semibold text-accent-cyan">{n.source}</span>
              <span>·</span>
              <span>{n.publishedAt}</span>
            </div>
          </div>
        </a>
      ))}
      {news.length === 0 && (
        <p className="text-center text-sm text-text-muted py-8">Не удалось загрузить новости</p>
      )}
    </div>
  );
}

// ─── Индикатор LIVE ──────────────────────────────────────────────────────────
function LiveIndicator() {
  return (
    <span className="flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
      LIVE
    </span>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function NewsPage() {
  const [gridSize, setGridSize] = useState<GridSize>(4);
  const [activeIds, setActiveIds] = useState<string[]>(CHANNELS.slice(0, 4).map((c) => c.id));
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "feed" | "crypto">("live");

  function toggleChannel(id: string) {
    setActiveIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= gridSize
        ? [...prev.slice(1), id]
        : [...prev, id]
    );
  }

  function setGrid(n: GridSize) {
    setGridSize(n);
    setActiveIds(CHANNELS.slice(0, n).map((c) => c.id));
  }

  const visibleChannels = CHANNELS.filter((c) => activeIds.includes(c.id));
  const fullscreenCh = fullscreenId ? CHANNELS.find((c) => c.id === fullscreenId) : null;

  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    4: "grid-cols-1 md:grid-cols-2",
    6: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  }[gridSize];

  // Полноэкранный режим
  if (fullscreenCh) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col bg-black">
        <div className="flex items-center justify-between bg-bg-panel px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">{fullscreenCh.name}</span>
            <LiveIndicator />
          </div>
          <button onClick={() => setFullscreenId(null)} className="btn-outline px-3 py-1.5 text-xs">
            ✕ Закрыть
          </button>
        </div>
        <div className="relative flex-1">
          <LiveStream channelId={fullscreenCh.channelId} name={fullscreenCh.name} muted={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Заголовок + табы */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Новости & ТВ</h1>
          <p className="text-sm text-text-muted">Прямые эфиры, TradingView лента и крипто-новости</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Табы */}
          <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
            {([
              { key: "live", label: "📺 Live TV" },
              { key: "feed", label: "📊 TV Timeline" },
              { key: "crypto", label: "📰 Крипто" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${tab === key ? "bg-accent-cyan text-bg-deep" : "text-text-muted hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Сетка (только для Live TV) */}
          {tab === "live" && (
            <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
              {([1, 2, 4, 6] as GridSize[]).map((n) => (
                <button
                  key={n}
                  onClick={() => setGrid(n)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${gridSize === n ? "bg-white/15 text-white" : "text-text-muted hover:text-white"}`}
                >
                  {n === 1 ? "1×1" : n === 2 ? "1×2" : n === 4 ? "2×2" : "2×3"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── TradingView лента ─── */}
      {tab === "feed" && (
        <div className="card overflow-hidden p-0" style={{ height: 640 }}>
          <TradingViewNews />
        </div>
      )}

      {/* ─── Крипто-новости ─── */}
      {tab === "crypto" && (
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Крипто-новости (English)</h2>
            <span className="text-[10px] text-text-muted">источник: CryptoCompare</span>
          </div>
          <CryptoNewsFeed />
        </div>
      )}

      {/* ─── Live TV ─── */}
      {tab === "live" && (
        <>
          {/* Выбор каналов */}
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((ch) => {
              const active = activeIds.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
                      : "border-border bg-bg-panel text-text-muted hover:text-white"
                  }`}
                >
                  {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-cyan" />}
                  <span>{ch.name}</span>
                  <span className="text-[9px] opacity-70">{ch.category}</span>
                </button>
              );
            })}
          </div>

          {/* Примечание о YouTube */}
          <div className="rounded-xl border border-accent-gold/20 bg-accent-gold/5 px-4 py-2 text-[11px] text-accent-gold">
            ⚠ Если канал не в эфире - отображается заглушка с кнопкой открыть на YouTube. Работа зависит от расписания канала.
          </div>

          {/* Сетка трансляций */}
          {visibleChannels.length === 0 ? (
            <div className="card grid place-items-center py-20 text-text-muted">
              Выберите каналы выше
            </div>
          ) : (
            <div className={`grid gap-4 ${gridClass}`}>
              {visibleChannels.map((ch) => (
                <div key={ch.id} className="card group overflow-hidden p-0">
                  <div className="flex items-center justify-between bg-bg-panel px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: ch.color }}
                      />
                      <span className="text-sm font-semibold text-white">{ch.name}</span>
                      <LiveIndicator />
                    </div>
                    <div className="flex gap-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => setFullscreenId(ch.id)}
                        className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-text-muted hover:text-white"
                      >
                        ⛶ Fullscreen
                      </button>
                    </div>
                  </div>
                  <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
                    <LiveStream channelId={ch.channelId} name={ch.name} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
