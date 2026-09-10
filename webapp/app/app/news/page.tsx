"use client";

// Раздел «ТВ»: прямые эфиры, лента TradingView и крипто-новости.
//
// Собран из тех же панелей, что терминал и «Рынок»: рамка, шапка в строку,
// чипы вместо крупных кнопок. Раньше здесь были просторные карточки со своими
// цветами, и раздел выглядел вставкой из другого приложения.

import { useIntlLocale, useT } from "@/lib/i18n";
import { useLocale, type Locale } from "@/lib/i18n/locale";
import { API_URL } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Maximize2, Newspaper, Radio, Tv, X } from "lucide-react";
import { useTerminalTheme } from "@/lib/terminalTheme";
import { CHIP, CHIP_OFF, CHIP_ON, Pane, PaneHead, PaneScope } from "@/components/app/Pane";

// ─── Каналы с настоящими YouTube Channel ID (не handle!) ───────────────────
// Важно: каналы должны разрешать embedding. CNBC и Al Jazeera - блокируют.
const CHANNELS = [
  { id: "bloomberg", name: "Bloomberg Markets", category: "Finance 🇺🇸", channelId: "UCIALMKvObZNtJ6AmdCLP7Lg", color: "#1a56db" },
  { id: "dw", name: "DW News", category: "World 🇩🇪", channelId: "UCknLrEdhRCp1aegoMqRaCZg", color: "#cc0000" },
  { id: "france24", name: "France 24 English", category: "World 🇫🇷", channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg", color: "#0050a0" },
  { id: "skynews", name: "Sky News", category: "World 🇬🇧", channelId: "UCoMdktPbSTixAyNGwb-UYkQ", color: "#cc2200" },
  { id: "euronews", name: "Euronews English", category: "World 🇪🇺", channelId: "UCg2JZBwgSYMaFQFm26LQZEQ", color: "#ff6600" },
  { id: "wion", name: "WION", category: "World 🌏", channelId: "UCbRNB7d5AKF1HxlHFVkdSqw", color: "#e00000" },
];

type Channel = (typeof CHANNELS)[number];
type GridSize = 1 | 2 | 4 | 6;
type Tab = "live" | "feed" | "crypto";

const GRIDS: { size: GridSize; label: string }[] = [
  { size: 1, label: "1×1" },
  { size: 2, label: "1×2" },
  { size: 4, label: "2×2" },
  { size: 6, label: "2×3" },
];

const GRID_CLASS: Record<GridSize, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  4: "grid-cols-1 md:grid-cols-2",
  6: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
};

const TABS: { key: Tab; icon: React.ReactNode }[] = [
  { key: "live", icon: <Tv className="h-3.5 w-3.5" /> },
  { key: "feed", icon: <Radio className="h-3.5 w-3.5" /> },
  { key: "crypto", icon: <Newspaper className="h-3.5 w-3.5" /> },
];

/** Страница канала на YouTube: по идентификатору, а не по имени - имени у нас нет. */
function channelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}/live`;
}

// ─── Эфир ────────────────────────────────────────────────────────────────────

function LiveStream({ channelId, name, muted = true }: { channelId: string; name: string; muted?: boolean }) {
  const t = useT();
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const src =
    `https://www.youtube.com/embed/live_stream` +
    `?channel=${channelId}` +
    `&autoplay=1` +
    `${muted ? "&mute=1" : ""}` +
    `&controls=1&rel=0&modestbranding=1&iv_load_policy=3`;

  return (
    // Экран эфира чёрный в обеих темах: видео светлее не станет, а белая
    // рамка вокруг тёмного кадра читается как незагрузившаяся картинка.
    <div className="relative h-full w-full bg-black">
      {!loaded && !offline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
          <span className="text-[11px] text-white/50">{t.news.loadingStream}</span>
        </div>
      )}

      {offline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <p className="text-[12px] font-semibold text-white/90">{name}</p>
          <p className="text-[11px] text-white/50">{t.news.offline}</p>
          <a
            href={channelUrl(channelId)}
            target="_blank"
            rel="noopener noreferrer"
            className={`${CHIP} mt-1 inline-flex items-center gap-1 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white`}
          >
            <ExternalLink className="h-3 w-3" />
            {t.news.openOnYoutube}
          </a>
        </div>
      )}

      {!offline && (
        <iframe
          key={channelId}
          src={src}
          title={name}
          loading="lazy"
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

/** Метка прямого эфира - та же, что у живых данных в терминале. */
function LiveBadge() {
  return (
    <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--pane-down)]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      Live
    </span>
  );
}

function StreamPane({ channel, onExpand }: { channel: Channel; onExpand: () => void }) {
  const t = useT();
  return (
    <section className="group overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: channel.color }} />
          <h2 className="truncate text-[12px] font-semibold text-[var(--pane-text)]">{channel.name}</h2>
          <LiveBadge />
        </div>
        <button
          onClick={onExpand}
          title={t.news.fullscreen}
          aria-label={t.news.fullscreen}
          className={`${CHIP} ${CHIP_OFF} opacity-60 group-hover:opacity-100`}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="relative" style={{ aspectRatio: "16/9" }}>
        <LiveStream channelId={channel.channelId} name={channel.name} />
      </div>
    </section>
  );
}

// ─── Лента TradingView ───────────────────────────────────────────────────────

/**
 * Лента новостей TradingView в нашей панели.
 *
 * Тему чужой скрипт берёт один раз, при сборке, поэтому на смене темы виджет
 * собирается заново. Фон - цветом панели: своей рамки у него нет, и любое
 * расхождение цвета читается швом.
 */
function TradingViewNews() {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTerminalTheme();

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
      isTransparent: false,
      backgroundColor: theme === "light" ? "#ffffff" : "#181a20",
      displayMode: "regular",
      width: "100%",
      height: "100%",
      colorTheme: theme,
      locale: "ru",
    });
    container.appendChild(script);
    return () => {
      container.innerHTML = "";
    };
  }, [theme]);

  return <div ref={ref} className="tradingview-widget-container h-full w-full" />;
}

// ─── Крипто-новости ──────────────────────────────────────────────────────────

// Новости берём у своего сервера, а он - из RSS самих изданий. Раньше лента
// шла от CryptoCompare прямо из браузера; тот закрыл бесплатный доступ ключом,
// и раздел молча опустел.

/** Строка ленты - так её отдаёт `/api/market/news`. */
interface NewsItem {
  title: string;
  url: string;
  source: string;
  /** Время публикации, секунды; 0 - издание его не указало. */
  published: number;
  summary: string;
}

/** Откуда лента на каждом языке - подписью в шапке панели. */
const NEWS_SOURCES: Record<Locale, string> = {
  ru: "ForkLog · Bits.media · Incrypted",
  en: "Cointelegraph · Decrypt · The Block",
};

function CryptoNewsFeed({ lang }: { lang: Locale }) {
  const t = useT();
  const numbers = useIntlLocale();
  // null - ещё грузится; пустой массив - сервер ответил, но новостей нет.
  const [news, setNews] = useState<NewsItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    setNews(null);
    fetch(`${API_URL}/api/market/news?lang=${lang}`, {
      headers: { "ngrok-skip-browser-warning": "1" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: NewsItem[] } | null) => {
        if (alive) setNews(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => alive && setNews([]));
    return () => {
      alive = false;
    };
  }, [lang]);

  if (news === null) {
    return (
      <div className="space-y-2 p-3">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md bg-[var(--pane-hover)]"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }

  if (!news.length) {
    return <p className="py-10 text-center text-[12px] text-[var(--pane-muted)]">{t.news.loadFailed}</p>;
  }

  return (
    <ul className="max-h-[640px] divide-y divide-[var(--pane-border)] overflow-y-auto">
      {news.map((n) => (
        <li key={n.url}>
          <a
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2.5 transition-colors duration-150 hover:bg-[var(--pane-hover)]"
          >
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--pane-text)]">{n.title}</p>
            {n.summary && <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--pane-muted)]">{n.summary}</p>}
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--pane-muted)]">
              <span className="font-semibold text-[var(--pane-chip)]">{n.source}</span>
              {n.published > 0 && (
                <>
                  <span>·</span>
                  <span className="font-mono tabular-nums">
                    {new Date(n.published * 1000).toLocaleString(numbers, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              )}
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

// ─── Во весь экран ───────────────────────────────────────────────────────────

function Fullscreen({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const t = useT();

  // Выход по Esc: так закрывается любое окно, и искать кнопку глазами поверх
  // видео незачем.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <PaneScope className="fixed inset-0 z-[100] flex flex-col bg-black">
      <div className="flex items-center justify-between border-b border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: channel.color }} />
          <span className="text-[12px] font-semibold text-[var(--pane-text)]">{channel.name}</span>
          <LiveBadge />
        </div>
        <button onClick={onClose} className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1`}>
          <X className="h-3.5 w-3.5" />
          {t.news.closeFullscreen}
        </button>
      </div>
      <div className="relative flex-1">
        <LiveStream channelId={channel.channelId} name={channel.name} muted={false} />
      </div>
    </PaneScope>
  );
}

// ─── Страница ────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const t = useT();
  const [gridSize, setGridSize] = useState<GridSize>(4);
  const [activeIds, setActiveIds] = useState<string[]>(CHANNELS.slice(0, 4).map((c) => c.id));
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  // Язык ленты - по языку интерфейса, пока человек не выбрал другой сам:
  // англоязычные издания быстрее, русские - понятнее.
  const locale = useLocale();
  const [newsLang, setNewsLang] = useState<Locale | null>(null);
  const feedLang = newsLang ?? locale;

  const labels: Record<Tab, string> = { live: t.news.tabLive, feed: t.news.tabFeed, crypto: t.news.tabCrypto };

  function toggleChannel(id: string) {
    setActiveIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= gridSize
          ? [...prev.slice(1), id]
          : [...prev, id],
    );
  }

  function setGrid(n: GridSize) {
    setGridSize(n);
    setActiveIds(CHANNELS.slice(0, n).map((c) => c.id));
  }

  const visible = CHANNELS.filter((c) => activeIds.includes(c.id));
  const fullscreen = fullscreenId ? CHANNELS.find((c) => c.id === fullscreenId) : null;

  if (fullscreen) {
    return <Fullscreen channel={fullscreen} onClose={() => setFullscreenId(null)} />;
  }

  return (
    <PaneScope className="space-y-3">
      <PaneHead title={t.news.title} hint={t.news.tabHints[tab]}>
        {tab === "live" &&
          GRIDS.map(({ size, label }) => (
            <button
              key={size}
              onClick={() => setGrid(size)}
              title={t.news.grid}
              className={`${CHIP} font-mono tabular-nums ${gridSize === size ? CHIP_ON : CHIP_OFF}`}
            >
              {label}
            </button>
          ))}
      </PaneHead>

      {/* Вкладки сегментами, как на «Рынке» и в терминале. */}
      <nav className="no-scrollbar flex overflow-x-auto rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] p-0.5">
        {TABS.map(({ key, icon }) => {
          const on = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              title={t.news.tabHints[key]}
              className="flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold transition-colors duration-150"
              style={{
                background: on ? "var(--pane-chip-faint)" : "transparent",
                color: on ? "var(--pane-chip)" : "var(--pane-muted)",
              }}
            >
              {icon}
              {labels[key]}
            </button>
          );
        })}
      </nav>

      {tab === "feed" && (
        <Pane
          title={t.news.tabFeed}
          actions={
            <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--pane-muted)]">
              TradingView
            </span>
          }
          body="h-[640px]"
        >
          <TradingViewNews />
        </Pane>
      )}

      {tab === "crypto" && (
        <Pane
          title={t.news.cryptoTitle}
          hint={NEWS_SOURCES[feedLang]}
          body=""
          actions={(["ru", "en"] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => setNewsLang(lang)}
              className={`${CHIP} font-semibold uppercase ${feedLang === lang ? CHIP_ON : CHIP_OFF}`}
            >
              {lang}
            </button>
          ))}
        >
          <CryptoNewsFeed lang={feedLang} />
        </Pane>
      )}

      {tab === "live" && (
        <>
          {/* Каналы - чипами в одну строку: выбор здесь делают на ходу, между
              сделками, и крупные карточки для этого лишние. */}
          <div className="flex flex-wrap items-center gap-1">
            {CHANNELS.map((ch) => {
              const on = activeIds.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  className={`${CHIP} inline-flex items-center gap-1.5 border ${
                    on ? `${CHIP_ON} border-[var(--pane-chip-faint)]` : `${CHIP_OFF} border-[var(--pane-border)]`
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: on ? ch.color : "var(--pane-muted)" }}
                  />
                  <span className="font-semibold">{ch.name}</span>
                  <span className="text-[9px] opacity-70">{ch.category}</span>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-[var(--pane-muted)]">{t.news.youtubeNote}</p>

          {visible.length === 0 ? (
            <Pane body="grid place-items-center py-20 text-[12px] text-[var(--pane-muted)]">
              {t.news.pickChannels}
            </Pane>
          ) : (
            <div className={`grid gap-3 ${GRID_CLASS[gridSize]}`}>
              {visible.map((ch) => (
                <StreamPane key={ch.id} channel={ch} onExpand={() => setFullscreenId(ch.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </PaneScope>
  );
}
