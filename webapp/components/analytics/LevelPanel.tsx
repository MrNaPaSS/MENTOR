"use client";

// Уровень трейдера: номер и звание, опыт до следующего и из чего он сложился.
//
// Бык на вершине с флагом - то, куда ведут уровни. Он стоит между званием и
// числом опыта и прячется на узком экране: там ему не хватает места, а цифры
// важнее картинки.

/* eslint-disable @next/next/no-img-element */

import CoinIcon from "@/components/app/CoinIcon";
import { useIntlLocale, useT } from "@/lib/i18n";
import { LEVEL_ART, XP_ART, type XpSource } from "@/lib/analytics/rewards";

export interface XpPart {
  key: XpSource;
  val: number;
}

export default function LevelPanel({
  level,
  xp,
  xpInLevel,
  xpNeeded,
  coins,
  parts,
}: {
  level: number;
  xp: number;
  xpInLevel: number;
  xpNeeded: number;
  /** Баланс монет. Null - ещё не пришёл, и значок не показываем. */
  coins: number | null;
  parts: XpPart[];
}) {
  const t = useT();
  const numbers = useIntlLocale();
  const titles = t.analytics.level.titles;
  const title = Object.entries(titles).reverse().find(([l]) => level >= +l)?.[1] ?? titles[1];
  const pct = xpNeeded > 0 ? Math.min(100, (xpInLevel / xpNeeded) * 100) : 100;

  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <img src={LEVEL_ART} alt="" className="h-7 w-7" />
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.analytics.level.title}</h2>
        </div>
        {coins !== null && (
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--pane-gold-soft)] bg-[var(--pane-gold)]/10 px-2.5 py-1">
            <CoinIcon size={15} />
            <span className="font-mono text-sm font-extrabold tabular-nums text-[var(--pane-gold)]">
              {coins.toLocaleString(numbers)}
            </span>
            <span className="text-[9px] font-bold text-[var(--pane-gold)]/60">NMNH</span>
          </div>
        )}
      </header>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-[var(--pane-gold-soft)] bg-[var(--pane-gold)]/10">
          <span className="text-[8px] font-bold uppercase leading-none tracking-wider text-[var(--pane-gold)]/70">
            {t.analytics.level.short}
          </span>
          <span className="font-mono text-2xl font-black leading-none text-[var(--pane-gold)]">{level}</span>
        </div>
        <div className="min-w-0 shrink-0">
          <p className="text-sm font-bold text-[var(--pane-text)]">{title}</p>
          <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">
            {t.analytics.level.toNext(Math.max(0, xpNeeded - xpInLevel).toLocaleString(numbers), level + 1)}
          </p>
        </div>
        <img
          src="/art/level-summit.webp"
          alt=""
          className="pointer-events-none -my-6 hidden h-36 min-w-0 flex-1 object-contain sm:block"
        />
        <div className="ml-auto shrink-0 text-right">
          <span className="font-mono text-2xl font-extrabold leading-none tabular-nums text-[var(--pane-text)]">
            {xp.toLocaleString(numbers)}
          </span>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-[var(--pane-muted)]">
            {t.analytics.level.totalXp}
          </p>
        </div>
      </div>

      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--pane-hover)]">
        <div
          className="h-full origin-left rounded-full transition-transform duration-700 ease-out"
          style={{
            transform: `scaleX(${pct / 100})`,
            background: "linear-gradient(90deg, color-mix(in srgb, var(--pane-gold) 55%, #6b3f00), var(--pane-gold))",
          }}
        />
      </div>
      <p className="mt-1.5 text-right font-mono text-[10px] tabular-nums text-[var(--pane-muted)]">
        {xpInLevel.toLocaleString(numbers)} / {xpNeeded.toLocaleString(numbers)} XP
      </p>

      {/* Разбивка опыта прижата к низу: коробка тянется до высоты соседней с
          сертификатами, и пустое место остаётся над плитками, а не под ними. */}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-3">
        {parts.map(({ key, val }) => (
          <div
            key={key}
            className="flex items-center gap-2.5 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-hover)] py-1.5 pl-1.5 pr-3"
          >
            <img src={XP_ART[key]} alt="" className="h-8 w-8 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--pane-text-2)]">
              {t.analytics.level.sources[key]}
            </span>
            <span
              className={`font-mono text-[12px] font-bold tabular-nums ${
                val > 0 ? "text-[var(--pane-text)]" : "text-[var(--pane-muted)]/60"
              }`}
            >
              +{val.toLocaleString(numbers)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
