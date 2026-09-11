"use client";

// Карточка товара маркета - в духе достижений аналитики: превью сверху, цвет
// рамки по тому, как продаётся товар, звезда у купленного.
//
// Превью - то, что человек получит. У рамки аватара - его же аватар в ней,
// круглый (чат) и квадратный (профиль). У товара с картинкой - сама картинка
// или снимок TradingView по ссылке. У остального - крупная иконка на
// подсветке цветом карточки.

import { useEffect, useState } from "react";
import { Check, ExternalLink, Lock } from "lucide-react";
import CoinIcon from "@/components/app/CoinIcon";
import type { Entitlement, ShopItem } from "@/lib/api";
import { useIntlLocale, useT, useLocale } from "@/lib/i18n";
import { cardImage } from "@/lib/tvImage";
import { frameOfFeature, rankFrame, type FrameId } from "@/lib/frames";
import { useTerminalTheme } from "@/lib/terminalTheme";
import FramedAvatar from "@/components/avatar/FramedAvatar";
import ShopIcon from "./ShopIcon";
import { itemDescription, itemTitle } from "@/lib/shopText";

/** Как продаётся товар - от этого цвет карточки, как редкость у достижений. */
export type Tier = "forever" | "days" | "charges" | "manual" | "merch" | "free" | "rank";

const TIER: Record<Tier, { border: string; glow: string; badge: string; tint: string }> = {
  forever: {
    border: "border-accent-gold/40",
    glow: "shadow-[0_0_18px_rgba(240,185,11,0.22)]",
    badge: "bg-accent-gold/20 text-[var(--pane-gold)]",
    tint: "rgba(240,185,11,0.18)",
  },
  days: {
    border: "border-blue-400/40",
    glow: "shadow-[0_0_14px_rgba(96,165,250,0.22)]",
    badge: "bg-blue-400/20 text-blue-400",
    tint: "rgba(96,165,250,0.18)",
  },
  charges: {
    border: "border-purple-400/40",
    glow: "shadow-[0_0_14px_rgba(167,139,250,0.24)]",
    badge: "bg-purple-400/20 text-purple-400",
    tint: "rgba(167,139,250,0.18)",
  },
  manual: {
    border: "border-[var(--pane-border)]",
    glow: "",
    badge: "bg-black/40 text-white/85",
    tint: "rgba(10,255,224,0.10)",
  },
  merch: {
    border: "border-accent-gold/30",
    glow: "shadow-[0_0_16px_rgba(240,185,11,0.18)]",
    badge: "bg-accent-gold/20 text-[var(--pane-gold)]",
    tint: "rgba(25,230,140,0.14)",
  },
  free: {
    border: "border-[var(--pane-border)]",
    glow: "",
    badge: "bg-black/40 text-white/70",
    tint: "rgba(10,255,224,0.12)",
  },
  rank: {
    border: "border-accent-gold/25",
    glow: "",
    badge: "bg-accent-gold/20 text-[var(--pane-gold)]",
    tint: "rgba(240,185,11,0.14)",
  },
};

/**
 * Иллюстрации функций маркета. Берутся, когда у товара нет своей обложки:
 * ментор может заменить её в админке, а без этого карточка не пустая.
 */
const FEATURE_ART: Record<string, string> = {
  streak_freeze: "/shop/streak-freeze.webp",
  streak_boost: "/shop/streak-boost.webp",
  journal_export: "/shop/journal-export.webp",
  // Инструменты терминала - из листа «магазин / инструменты».
  tool_vision: "/shop/tool-vision.webp",
  tool_footprint: "/shop/tool-footprint.webp",
  tool_volume_candles: "/shop/tool-volume-candles.webp",
  tool_dom_depth: "/shop/tool-depth.webp",
  tool_dom_step25: "/shop/tool-step25.webp",
};

export function tierOf(item: ShopItem): Tier {
  if (item.category === "merch") return "merch";
  if (!item.feature) return item.price > 0 ? "manual" : "free";
  if ((item.charges ?? 0) > 0) return "charges";
  if ((item.duration_days ?? 0) > 0) return "days";
  return "forever";
}

const BTN =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold " +
  "transition-[transform,opacity,background-color] duration-150 ease-out active:scale-[0.97]";

type Me = { src: string | null; name: string };

export default function ShopCard({
  item,
  balance,
  access,
  me,
  equipped,
  rank,
  onBuy,
  onEquip,
}: {
  item: ShopItem;
  balance: number;
  /** Действующий доступ к функции этого товара, если куплен. */
  access: Entitlement | null;
  /** Чей аватар показывать в превью рамки. */
  me: Me;
  /** Надетая сейчас рамка. */
  equipped: string;
  /** Карточка рамки лидерборда: не продаётся, даётся за место. */
  rank?: number;
  onBuy: (item: ShopItem) => void;
  onEquip: (frame: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const numbers = useIntlLocale();
  const theme = useTerminalTheme();
  const tier: Tier = rank ? "rank" : tierOf(item);
  const look = TIER[tier];
  const frame = rank ? rankFrame(rank) : frameOfFeature(item.feature);
  const forever = Boolean(item.feature) && !(item.charges ?? 0) && !(item.duration_days ?? 0);
  const owned = forever && Boolean(access?.permanent);
  const wearing = Boolean(frame) && equipped === frame;
  const short = Math.max(0, item.price - balance);
  const progress = item.price > 0 ? Math.min(100, Math.round((balance / item.price) * 100)) : 100;

  const badge = rank
    ? t.shop.rankLock(rank)
    : tier === "charges"
      ? t.shop.terms.charges(item.charges ?? 0)
      : tier === "days"
        ? t.shop.terms.days(item.duration_days ?? 0)
        : tier === "forever"
          ? t.shop.terms.forever
          : tier === "manual"
            ? t.shop.terms.manual
            : tier === "merch"
              ? t.shop.terms.delivery
              : t.shop.terms.free;

  let status = "";
  if (access && !frame) {
    if (access.permanent) status = t.shop.forever;
    else if ((access.charges ?? 0) > 0) status = t.shop.chargesLeft(access.charges);
    else if (access.expires_at)
      status = t.shop.until(
        new Date(access.expires_at).toLocaleDateString(numbers, { day: "numeric", month: "short" }),
      );
  }

  const title = rank && frame ? t.shop.rankFrames[frame] ?? item.title : itemTitle(item, locale);
  const description = rank ? t.shop.rankOnly(rank) : itemDescription(item, locale);

  let action: React.ReactNode;
  if (rank) {
    action = (
      <span className={`${BTN} cursor-default border border-[var(--pane-border)] text-[var(--pane-muted)]`}>
        <Lock className="h-3 w-3" />
        {t.shop.rankLock(rank)}
      </span>
    );
  } else if (frame && owned) {
    action = wearing ? (
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onEquip("")}
          className="text-[10px] text-[var(--pane-muted)] underline-offset-2 transition-colors duration-150 ease-out hover:text-[var(--pane-text)] hover:underline"
        >
          {t.shop.unequip}
        </button>
        <span className={`${BTN} bg-[var(--pane-up-faint)] text-[var(--pane-up)]`}>
          <Check className="h-3 w-3" />
          {t.shop.equipped}
        </span>
      </span>
    ) : (
      <button type="button" onClick={() => onEquip(frame)} className={`${BTN} text-black`} style={{ background: "var(--pane-gold)" }}>
        {t.shop.equip}
      </button>
    );
  } else if (owned) {
    action = (
      <span className={`${BTN} bg-[var(--pane-up-faint)] text-[var(--pane-up)]`}>
        <Check className="h-3 w-3" />
        {t.shop.bought}
      </span>
    );
  } else if (item.price <= 0) {
    action = item.link_url ? (
      <a
        href={item.link_url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${BTN} border border-[var(--pane-border)] text-[var(--pane-accent)] hover:bg-[var(--pane-hover)]`}
      >
        <ExternalLink className="h-3 w-3" />
        {t.shop.openLink}
      </a>
    ) : (
      <span className="text-[10px] text-[var(--pane-muted)]">{t.shop.soon}</span>
    );
  } else if (short > 0) {
    // Кнопка на месте и когда не хватает: сколько накоплено, видно по полосе
    // рядом, а сколько осталось - в подсказке.
    action = (
      <span
        title={t.shop.notEnough(short.toLocaleString(numbers))}
        className={`${BTN} cursor-not-allowed border border-[var(--pane-border)] text-[var(--pane-muted)]`}
      >
        <CoinIcon size={13} />
        {t.shop.buy}
      </span>
    );
  } else {
    action = (
      <button type="button" onClick={() => onBuy(item)} className={`${BTN} text-black`} style={{ background: "var(--pane-gold)" }}>
        <CoinIcon size={13} />
        {access ? ((item.charges ?? 0) > 0 ? t.shop.buyMore : t.shop.extend) : t.shop.buy}
      </button>
    );
  }

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-[var(--pane-bg)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transform-none ${look.border} ${owned || wearing ? look.glow : ""}`}
    >
      <Preview item={item} frame={frame} rank={rank} me={me} tint={look.tint} />

      <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-bold backdrop-blur-sm ${look.badge}`}>
        {badge}
      </span>
      {owned && (
        // Та же звезда, что у полученных достижений в аналитике.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={theme === "light" ? "/marks/star.png" : "/marks/star-green.png"}
          alt=""
          className="pointer-events-none absolute right-2 top-2 h-5 w-5"
        />
      )}

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="text-[13px] font-bold leading-snug text-[var(--pane-text)]">{title}</h3>
        {description && (
          <p className="line-clamp-3 text-[11px] leading-snug text-[var(--pane-muted)]">{description}</p>
        )}
        {status && (
          <span className="w-fit rounded bg-[var(--pane-up-faint)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--pane-up)]">
            {status}
          </span>
        )}
        {item.link_url && item.price > 0 && (
          <a
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-[10px] text-[var(--pane-accent)] hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {t.shop.details}
          </a>
        )}

        {/* Низ карточки по макету: сколько накоплено, цена и кнопка - одной
            строкой. Полоса стоит и у доступного товара: полная, она говорит
            «хватает» раньше, чем прочитана цена. */}
        <div className="mt-auto flex items-end gap-2 pt-2">
          <div className="min-w-0 flex-1">
            {!owned && !rank && item.price > 0 && (
              <>
                <p className="text-[10px] text-[var(--pane-muted)]">{t.shop.saved(String(progress))}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--pane-hover)]">
                  <div
                    className="h-full origin-left rounded-full bg-[var(--pane-gold)] transition-transform duration-700 ease-out"
                    style={{ transform: `scaleX(${progress / 100})` }}
                  />
                </div>
              </>
            )}
          </div>
          {!owned && !rank && item.price > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--pane-border)] px-2 py-1 font-mono text-[12px] font-bold tabular-nums text-[var(--pane-gold)]">
              <CoinIcon size={13} />
              {item.price.toLocaleString(numbers)}
              <span className="text-[8px] font-bold opacity-60">NMNH</span>
            </span>
          )}
          <div className="shrink-0">{action}</div>
        </div>
      </div>
    </article>
  );
}

function Preview({
  item,
  frame,
  rank,
  me,
  tint,
}: {
  item: ShopItem;
  frame: FrameId | null;
  rank?: number;
  me: Me;
  tint: string;
}) {
  const own = frame ? null : cardImage(item.image_url, item.link_url);
  const art = !frame && !own && item.feature ? FEATURE_ART[item.feature] ?? null : null;
  const image = own ?? art;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  const glow = { background: `radial-gradient(circle at 50% 42%, ${tint}, transparent 70%)` };

  if (frame) {
    return (
      <div className="flex h-32 items-center justify-center gap-8 border-b border-[var(--pane-border)]" style={glow}>
        <FramedAvatar src={me.src} name={me.name} size={52} frame={frame} rank={rank} />
        <FramedAvatar src={me.src} name={me.name} size={44} frame={frame} rank={rank} shape="square" radius={8} />
      </div>
    );
  }

  if (image && !broken) {
    // Мерч и иллюстрации функций показываем целиком, на подсветке: у кепки
    // или пульта обрезанный край - это обрезанный товар. Снимки TradingView
    // и обложки - во всю ширину, как было.
    const merch = item.category === "merch" || (art !== null && image === art);
    return (
      <div
        className={`relative overflow-hidden border-b border-[var(--pane-border)] ${merch ? "h-40" : "h-32"}`}
        style={merch ? glow : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className={`h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transform-none ${
            merch ? "object-contain p-2" : "object-cover"
          }`}
        />
        {!merch && (
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--pane-bg)] via-transparent to-transparent" />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-32 items-center justify-center border-b border-[var(--pane-border)]" style={glow}>
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-gold)] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]">
        <ShopIcon name={item.icon} className="h-7 w-7" />
      </span>
    </div>
  );
}
