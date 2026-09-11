"use client";

// Достижения: вкладки по категориям и карточки с объёмной картинкой каждого.
//
// Неполученное показывает свою картинку приглушённой, с замком в углу: видно,
// за чем идёшь, а не безликий замок на каждой второй карточке. Полученные
// стоят первыми - их и ищут глазами, открыв раздел.
//
// Список прокручивается, но окно его всегда высотой в целое число рядов:
// карточки одной высоты, и окно подгоняется под место в коробке. При
// открытии нижний ряд не стоит обрезанным по краю - дальше листают.

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { BarChart2, CalendarDays, Lock, Sparkles, TrendingUp, Trophy, Wallet } from "lucide-react";
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

/** Высота карточки и зазор между рядами: окно списка считается из них. */
const CARD_H = 80;
const GAP = 8;
/** Окно по умолчанию, пока место не измерено: четыре ряда. */
const DEFAULT_H = 4 * (CARD_H + GAP) - GAP;

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
  // Окно списка - целое число рядов в том месте, что осталось в коробке.
  const holder = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  useEffect(() => {
    const node = holder.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const rows = Math.max(2, Math.floor((entry.contentRect.height + GAP) / (CARD_H + GAP)));
      setFit(rows * (CARD_H + GAP) - GAP);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const earned = achievements.filter((a) => a.earned).length;
  const shown = achievements
    .filter((a) => category === "all" || a.category === category)
    // Полученные вперёд, внутри каждой группы порядок прежний: от простого к редкому.
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(y.a.earned) - Number(x.a.earned) || x.i - y.i)
    .map(({ a }) => a);

  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3 ${className}`}
    >
      {/* Заголовок и вкладки - одной строкой. Отдельный ряд вкладок съедал
          высоту, и пятый ряд наград уходил под прокрутку; теперь это место
          отдано списку. Счёт полученных - под названием, чтобы строке
          хватило ширины на все шесть вкладок. Где не хватает и так - на
          узком экране, - вкладки переносятся на свою строку целиком, а не
          обрезаются. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex shrink-0 items-center gap-2">
          <img src="/art/ach/vol_25m.webp" alt="" className="h-7 w-7" />
          <div className="flex flex-col gap-1">
            <h2 className="text-[12px] font-semibold leading-none text-[var(--pane-text)]">
              {t.analytics.achievements.title}
            </h2>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] font-bold leading-none tabular-nums text-[var(--pane-gold)]">
                {earned}/{achievements.length}
              </span>
              <div className="h-1 w-14 overflow-hidden rounded-full bg-[var(--pane-hover)]">
                <div
                  className="h-full origin-left rounded-full bg-[var(--pane-gold)] transition-transform duration-700 ease-out"
                  style={{ transform: `scaleX(${achievements.length ? earned / achievements.length : 0})` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex max-w-full gap-1 overflow-x-auto scrollbar-hide sm:ml-auto">
          {CATEGORIES.map((cat) => {
            const inCat = cat.id === "all" ? achievements : achievements.filter((a) => a.category === cat.id);
            const on = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
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
      </header>

      <div ref={holder} className="min-h-0 flex-1">
        <div
          key={category}
          className="grid animate-fade-in auto-rows-[80px] content-start gap-2 overflow-y-auto pr-1 motion-reduce:animate-none sm:grid-cols-2"
          style={{ height: fit ?? DEFAULT_H }}
        >
          {shown.map((ach) => (
            <Card key={ach.id} ach={ach} star={paper === "light" ? "/marks/star.png" : "/marks/star-green.png"} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ ach, star }: { ach: Achievement; star: string }) {
  const t = useT();
  const r = RARITY[ach.rarity];
  const copy = t.analytics.achievements.items[ach.id];
  return (
    <div
      className={`group relative flex h-[80px] items-center gap-3 overflow-hidden rounded-xl border px-3 transition-[transform,box-shadow] duration-200 ease-out ${r.border} ${
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
        <div className="flex min-w-0 items-center gap-2 pr-5">
          <h3 className="min-w-0 truncate text-[13px] font-bold leading-tight text-[var(--pane-text)]">{copy.title}</h3>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${r.badge}`}>
            {t.analytics.rarity[ach.rarity]}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] leading-snug text-[var(--pane-muted)]" title={copy.desc}>
          {copy.desc}
        </p>
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
