"use client";

// Колонка оформления в Пульсе: два баннера, цитата и шаг к терминалу.
//
// Цифр здесь нет намеренно. Пульс - первая вкладка рынка, и после пяти панелей
// с числами глазу нужно место, где остановиться; а кнопка в терминал - то, куда
// ведёт весь раздел: посмотрел на рынок - иди торговать.

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { Quote } from "lucide-react";
import { useT } from "@/lib/i18n";

export default function PulsePromo({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <img
        src="/art/market/bitcoin-leads.webp"
        alt={t.market.promo.bitcoinAlt}
        className="w-full rounded-xl border border-[var(--pane-border)] object-cover"
      />
      <img
        src="/art/market/global-market.webp"
        alt={t.market.promo.globalAlt}
        className="w-full rounded-xl border border-[var(--pane-border)] object-cover"
      />

      <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_auto]">
        <figure className="flex items-start gap-3 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3">
          <Quote className="h-6 w-6 shrink-0 text-[var(--pane-gold)]" />
          <div className="min-w-0">
            <blockquote className="text-[12px] leading-snug text-[var(--pane-text)]">{t.market.promo.quote}</blockquote>
            <figcaption className="mt-1.5 text-right text-[11px] font-semibold text-[var(--pane-muted)]">
              - {t.market.promo.author}
            </figcaption>
          </div>
        </figure>

        <Link
          href="/app/scalping"
          title={t.market.promo.ctaHint}
          className="group flex items-center justify-between gap-4 rounded-xl border border-accent-gold/50 bg-[var(--pane-gold)]/10 px-4 py-3 transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--pane-gold)]/15 active:scale-[0.98]"
        >
          <span className="text-[15px] font-extrabold uppercase leading-tight tracking-wide text-[var(--pane-text)]">
            {t.market.promo.cta.map((line) => (
              <span key={line} className="block whitespace-nowrap">
                {line}
              </span>
            ))}
          </span>
          <svg
            viewBox="0 0 24 24"
            aria-hidden
            className="h-7 w-7 text-[var(--pane-gold)] transition-transform duration-200 ease-out group-hover:translate-x-0.5"
          >
            <path d="M5 4v16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            <path d="M10 5l9 7-9 7z" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
