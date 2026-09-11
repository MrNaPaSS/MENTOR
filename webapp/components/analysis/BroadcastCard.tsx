"use client";

// Карточка разбора ментора: график, тикер с направлением, текст и график в
// терминале.
//
// Графики у всех карточек одной высоты: разборы стоят сеткой, и картинки
// разной высоты рвали строки - соседние карточки начинались на разной
// высоте. Длинный текст свёрнут до трёх строк: сетку читают по тикерам, а
// разбор целиком открывают тот, что заинтересовал.

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { CandlestickChart, ExternalLink, Eye, MessageCircle, ThumbsUp, TrendingUp } from "lucide-react";
import { api, API_URL, type BroadcastItem } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useInView } from "@/lib/useInView";
import BroadcastComments from "@/components/analysis/BroadcastComments";
import { directionOf } from "@/lib/analysisCard";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import ChartOverlay from "@/components/market/ChartOverlay";

/** Сколько знаков помещается в три строки карточки: длиннее - сворачиваем. */
const CLAMP_CHARS = 160;
const CLAMP_LINES = 3;

function chartImgUrl(url: string): string | null {
  if (url.startsWith("/uploads/")) return `${API_URL}${url}`;
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BroadcastCard({ item }: { item: BroadcastItem }) {
  const t = useT();
  const numbers = intlLocale(useLocale());
  const audience = t.signals.audience as Record<string, string>;
  const img = item.chart_url ? chartImgUrl(item.chart_url) : null;
  const direction = directionOf(item.text);
  const [chartOpen, setChartOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [views, setViews] = useState(item.views ?? 0);
  const [likes, setLikes] = useState(item.likes ?? 0);
  const [liked, setLiked] = useState(Boolean(item.liked));
  const [comments, setComments] = useState(item.comments ?? 0);
  const [talkOpen, setTalkOpen] = useState(false);
  const [liking, setLiking] = useState(false);

  // Просмотр отмечаем, когда карточку и правда увидели, - не при загрузке
  // ленты. Сервер считает человека один раз; метка в сессии бережёт от
  // повторного запроса при каждом возврате на страницу.
  const root = useRef<HTMLElement>(null);
  const seen = useInView(root, "0px");
  useEffect(() => {
    if (!seen) return;
    const key = `nmnh:viewed:${item.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Хранилище закрыто - отметим и так, сервер повтор не посчитает.
    }
    const token = getAccessToken();
    if (!token) return;
    api.broadcastView(token, item.id).then((r) => setViews(r.views)).catch(() => {});
  }, [seen, item.id]);

  async function like() {
    const token = getAccessToken();
    if (!token || liking) return;
    // Отклик сразу, ответ сервера поправит число, если кто-то лайкнул вместе.
    setLiking(true);
    setLiked((v) => !v);
    setLikes((n) => n + (liked ? -1 : 1));
    try {
      const r = await api.broadcastLike(token, item.id);
      setLiked(r.liked);
      setLikes(r.likes);
    } catch {
      setLiked(liked);
      setLikes((n) => n + (liked ? 1 : -1));
    } finally {
      setLiking(false);
    }
  }
  const long = item.text.length > CLAMP_CHARS || item.text.split("\n").length > CLAMP_LINES;

  const audienceBadge =
    item.audience !== "all" ? (
      <span className="rounded-full border border-[var(--pane-gold-soft)] bg-[color:color-mix(in_srgb,var(--pane-gold)_15%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--pane-gold)]">
        {audience[item.audience] ?? item.audience}
      </span>
    ) : null;

  return (
    <article ref={root} className="flex flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--pane-gold-soft)] hover:shadow-[0_12px_30px_-16px_rgba(0,0,0,0.45)] motion-reduce:hover:translate-y-0">
      {img && (
        <a
          href={item.chart_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block overflow-hidden border-b border-[var(--pane-border)]"
        >
          <img
            src={img}
            alt={item.symbol ?? t.signals.chart}
            loading="lazy"
            className="aspect-[16/9] w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:group-hover:scale-100"
          />
          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            <span className="flex items-center gap-1.5 rounded-lg border border-[var(--pane-border)] bg-[color:color-mix(in_srgb,var(--pane-bg)_90%,transparent)] px-2 py-1 text-[10px] font-semibold text-[var(--pane-text)] backdrop-blur-sm">
              <TrendingUp className="h-3 w-3 text-[var(--pane-accent)]" />
              {t.signals.analysisBadge}
            </span>
            {audienceBadge}
          </div>
          <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-lg bg-[color:color-mix(in_srgb,var(--pane-bg)_85%,transparent)] px-2.5 py-1 text-[10px] font-semibold text-[var(--pane-text-2)] opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100">
            <ExternalLink className="h-3 w-3" />
            TradingView
          </span>
        </a>
      )}

      <div className="flex flex-1 flex-col gap-1.5 px-3 pb-3 pt-2.5">
        <div className="flex items-center gap-2">
          {item.symbol ? (
            <span className="truncate font-mono text-[14px] font-bold text-[var(--pane-text)]">{item.symbol}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--pane-text)]">
              <TrendingUp className="h-3.5 w-3.5 text-[var(--pane-accent)]" />
              {t.signals.analysisBadge}
            </span>
          )}
          {direction && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                direction === "long"
                  ? "bg-[color:color-mix(in_srgb,var(--pane-up)_10%,transparent)] text-[var(--pane-up)]"
                  : "bg-[color:color-mix(in_srgb,var(--pane-down)_10%,transparent)] text-[var(--pane-down)]"
              }`}
            >
              {direction === "long" ? "LONG" : "SHORT"}
            </span>
          )}
          {!img && audienceBadge}
          <span className="ml-auto shrink-0 text-[11px] text-[var(--pane-muted)]">
            {fmtDate(item.created_at, numbers)}
          </span>
        </div>

        {item.text && (
          <div>
            <p
              className={`whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--pane-text-2)] ${
                long && !expanded ? "line-clamp-3" : ""
              }`}
            >
              {item.text}
            </p>
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-[11px] font-semibold text-[var(--pane-gold)] transition-opacity duration-150 hover:opacity-80"
              >
                {expanded ? t.signals.readLess : t.signals.readMore}
              </button>
            )}
          </div>
        )}

        {/* Просмотры, обсуждение и лайк - как под постом; справа график. */}
        <div className="mt-auto flex items-center gap-3 pt-1 text-[11px] text-[var(--pane-muted)]">
          <span className="flex items-center gap-1" title={t.signals.social.views}>
            <Eye className="h-3.5 w-3.5" />
            <span className="tabular-nums">{views.toLocaleString(numbers)}</span>
          </span>
          <button
            type="button"
            onClick={() => setTalkOpen((v) => !v)}
            aria-expanded={talkOpen}
            title={t.signals.social.comments}
            className={`flex items-center gap-1 transition-colors duration-150 hover:text-[var(--pane-text)] ${
              talkOpen ? "text-[var(--pane-text)]" : ""
            }`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span className="tabular-nums">{comments.toLocaleString(numbers)}</span>
          </button>
          <button
            type="button"
            onClick={() => void like()}
            aria-pressed={liked}
            title={t.signals.social.likes}
            className={`flex items-center gap-1 transition-[color,transform] duration-150 ease-out active:scale-[0.92] ${
              liked ? "text-[var(--pane-gold)]" : "hover:text-[var(--pane-text)]"
            }`}
          >
            <ThumbsUp className={`h-3.5 w-3.5 ${liked ? "fill-current" : ""}`} />
            <span className="tabular-nums">{likes.toLocaleString(numbers)}</span>
          </button>

          {item.symbol && (
            <button
              type="button"
              onClick={() => setChartOpen(true)}
              className="ml-auto flex items-center justify-center gap-1.5 rounded-lg bg-[var(--pane-hover)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--pane-accent)] ring-1 ring-inset ring-[var(--pane-accent-soft)] transition-colors duration-150 ease-out hover:bg-[var(--pane-accent-faint)]"
            >
              <CandlestickChart className="h-3.5 w-3.5" />
              {t.signals.openChart}
            </button>
          )}
        </div>

        {talkOpen && <BroadcastComments broadcastId={item.id} onCount={setComments} />}
      </div>

      {chartOpen && item.symbol && <ChartOverlay symbol={item.symbol} onClose={() => setChartOpen(false)} />}
    </article>
  );
}
