"use client";

// Достижения: вкладки по категориям и карточки с объёмной картинкой каждого.
//
// Неполученное показывает свою картинку приглушённой, с замком в углу: видно,
// за чем идёшь, а не безликий замок на каждой второй карточке. Полученные
// стоят первыми - их и ищут глазами, открыв раздел.
//
// Страницами по восемь карточек, а не прокруткой: при прокрутке нижний ряд
// всегда стоял обрезанным по краю коробки. Восемь - четыре ряда, это как раз
// высота соседних целей месяца.

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { BarChart2, CalendarDays, ChevronLeft, ChevronRight, Lock, Sparkles, TrendingUp, Trophy, Wallet } from "lucide-react";
import CoinIcon from "@/components/app/CoinIcon";
import { useT } from "@/lib/i18n";
import { useTerminalTheme } from "@/lib/terminalTheme";
import {
  achievementArt,
  RARITY_COINS,
  type AchCategory,
  type Achievement,
  type Rarity,
} from "@/lib/analytics/rewards";

const CATEGORIES: { id: AchCategory; icon: React.ElementType }[] = [
  { id: "all", icon: Trophy },
  { id: "volume", icon: BarChart2 },
  { id: "discipline", icon: CalendarDays },
  { id: "performance", icon: TrendingUp },
  { id: "deposit", icon: Wallet },
  { id: "special", icon: Sparkles },
];

/** Карточек на странице: четыре ряда по две. */
const PAGE = 8;

const RARITY: Record<Rarity, { border: string; glow: string; badge: string }> = {
  common: {
    border: "border-[var(--pane-border)]",
    glow: "",
    badge: "bg-[var(--pane-hover)] text-[var(--pane-text-2)]",
  },
  rare: {
    border: "border-blue-400/40",
    glow: "shadow-[0_0_12px_rgba(96,165,250,0.18)]",
    badge: "bg-blue-400/15 text-blue-500",
  },
  epic: {
    border: "border-purple-400/40",
    glow: "shadow-[0_0_12px_rgba(167,139,250,0.22)]",
    badge: "bg-purple-400/15 text-purple-500",
  },
  legendary: {
    border: "border-accent-gold/45",
    glow: "shadow-[0_0_16px_rgba(240,185,11,0.22)]",
    badge: "bg-[color:color-mix(in_srgb,var(--pane-gold)_15%,transparent)] text-[var(--pane-gold)]",
  },
};

export default function AchievementsPanel({
  achievements,
  className = "",
}: {
  achievements: Achievement[];
  className?: string;
}) {
  const t = useT();
  const paper = useTerminalTheme();
  const [category, setCategory] = useState<AchCategory>("all");
  const [page, setPage] = useState(0);
  const earned = achievements.filter((a) => a.earned).length;
  const shown = achievements
    .filter((a) => category === "all" || a.category === category)
    // Полученные вперёд, внутри каждой группы порядок прежний: от простого к редкому.
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(y.a.earned) - Number(x.a.earned) || x.i - y.i)
    .map(({ a }) => a);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PAGE, at * PAGE + PAGE);

  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3 ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <img src="/art/ach/vol_25m.webp" alt="" className="h-7 w-7" />
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.analytics.achievements.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold tabular-nums text-[var(--pane-gold)]">
            {earned}/{achievements.length}
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--pane-hover)]">
            <div
              className="h-full origin-left rounded-full bg-[var(--pane-gold)] transition-transform duration-700 ease-out"
              style={{ transform: `scaleX(${achievements.length ? earned / achievements.length : 0})` }}
            />
          </div>
        </div>
      </header>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {CATEGORIES.map((cat) => {
          const inCat = cat.id === "all" ? achievements : achievements.filter((a) => a.category === cat.id);
          const on = category === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setCategory(cat.id);
                setPage(0);
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-150 ease-out ${
                on
                  ? "border-accent-gold/50 bg-[color:color-mix(in_srgb,var(--pane-gold)_10%,transparent)] text-[var(--pane-gold)]"
                  : "border-[var(--pane-border)] bg-[var(--pane-hover)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
              }`}
            >
              <cat.icon className="h-3 w-3 shrink-0" />
              <span>{t.analytics.achievements.categories[cat.id]}</span>
              <span className={`font-mono text-[9px] ${on ? "text-[color:color-mix(in_srgb,var(--pane-gold)_70%,transparent)]" : "opacity-60"}`}>
                {inCat.filter((a) => a.earned).length}/{inCat.length}
              </span>
            </button>
          );
        })}
      </div>

      <div key={`${category}-${at}`} className="grid animate-fade-in auto-rows-max content-start gap-2 motion-reduce:animate-none sm:grid-cols-2">
        {slice.map((ach) => (
          <Card key={ach.id} ach={ach} star={paper === "light" ? "/marks/star.png" : "/marks/star-green.png"} />
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-auto flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setPage(Math.max(0, at - 1))}
            disabled={at === 0}
            aria-label="‹"
            className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--pane-border)] text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)] disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: pages }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPage(i)}
                aria-label={String(i + 1)}
                aria-current={i === at}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ease-out ${
                  i === at ? "w-5 bg-[var(--pane-gold)]" : "w-1.5 bg-[var(--pane-border)] hover:bg-[var(--pane-muted)]"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPage(Math.min(pages - 1, at + 1))}
            disabled={at === pages - 1}
            aria-label="›"
            className="grid h-7 w-7 place-items-center rounded-lg border border-[var(--pane-border)] text-[var(--pane-muted)] transition-colors duration-150 hover:text-[var(--pane-text)] disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  );
}

function Card({ ach, star }: { ach: Achievement; star: string }) {
  const t = useT();
  const r = RARITY[ach.rarity];
  const copy = t.analytics.achievements.items[ach.id];
  return (
    <div
      className={`group relative flex items-start gap-3 rounded-xl border p-3 transition-[transform,box-shadow] duration-200 ease-out ${r.border} ${
        ach.earned ? `${r.glow} bg-[color:color-mix(in_srgb,var(--pane-hover)_50%,transparent)] hover:-translate-y-0.5` : ""
      }`}
    >
      <div className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-xl border bg-[var(--pane-hover)] ${r.border}`}>
        <img
          src={achievementArt(ach.id)}
          alt=""
          loading="lazy"
          className={`h-10 w-10 object-contain transition-transform duration-200 ease-out ${
            ach.earned ? "group-hover:scale-110 motion-reduce:group-hover:scale-100" : "opacity-35 grayscale"
          }`}
        />
        {!ach.earned && (
          <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full border border-[var(--pane-border)] bg-[var(--pane-bg)]">
            <Lock className="h-2.5 w-2.5 text-[var(--pane-muted)]" />
          </span>
        )}
      </div>

      <div className={`min-w-0 flex-1 ${ach.earned ? "" : "opacity-70"}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-5">
          <h3 className="text-[13px] font-bold leading-tight text-[var(--pane-text)]">{copy.title}</h3>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${r.badge}`}>
            {t.analytics.rarity[ach.rarity]}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--pane-muted)]">{copy.desc}</p>
        <div className="mt-1 flex items-center gap-1">
          <CoinIcon size={13} />
          <span className="font-mono text-[10px] font-bold text-[var(--pane-gold)]">
            {ach.earned ? "" : "+"}
            {RARITY_COINS[ach.rarity]} NMNH
          </span>
        </div>
      </div>

      {/* Полученное помечено той же звездой, что лучший день календаря: одна
          отметка на всё, что заслужено. */}
      {ach.earned && (
        <img src={star} alt="" className="pointer-events-none absolute right-1.5 top-1.5 h-5 w-5" />
      )}
    </div>
  );
}
