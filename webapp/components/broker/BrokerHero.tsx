"use client";

import Link from "next/link";
import { ArrowRight, Check, Calculator } from "lucide-react";
import { CASHBACK_TIERS } from "@/lib/broker/program";
import { compactMoney, share } from "@/lib/broker/format";
import { useIntlLocale, useT } from "@/lib/i18n";

/**
 * Первый экран: обещание, снимок рабочего места и лестница уровней.
 *
 * Уровни стоят прямо в первом экране намеренно. Подписочные витрины прячут
 * условия под «подробнее о тарифах», и человек, который однажды в такое
 * упирался, ищет подвох раньше, чем читает заголовок. Здесь искать нечего:
 * вся сетка возврата видна до первого клика.
 */
export default function BrokerHero() {
  const t = useT();
  const locale = useIntlLocale();

  return (
    <section id="about" className="relative overflow-hidden pt-28 pb-14 md:pt-36 md:pb-20">
      <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-30 [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />

      <div className="relative mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="eyebrow">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan shadow-glow-cyan" />
              {t.broker.hero.eyebrow}
            </span>

            <h1 className="mt-4 text-h1 text-text-primary">
              <span className="glitch" data-text={t.broker.hero.titleTop}>
                {t.broker.hero.titleTop}
              </span>
              <br />
              <span className="text-accent-cyan text-glow-cyan">{t.broker.hero.titleAccent}</span>
            </h1>

            <p className="mt-5 max-w-xl text-lg text-text-secondary">{t.broker.hero.lead}</p>

            <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-text-muted">
              {t.broker.hero.bullets.map((item) => (
                <li key={item} className="inline-flex items-center gap-2">
                  <Check className="h-4 w-4 text-accent-cyan" />
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#calculator"
                className="inline-flex items-center gap-2 rounded-full bg-accent-cyan px-7 py-3 text-[15px] font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
              >
                <Calculator className="h-[15px] w-[15px]" />
                {t.broker.hero.ctaPrimary}
              </a>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3 text-[15px] font-semibold text-text-primary transition-all duration-200 hover:bg-bg-panel/60 active:scale-[0.97]"
              >
                {t.broker.hero.ctaSecondary} <ArrowRight className="h-[15px] w-[15px]" />
              </Link>
            </div>
          </div>

          {/* Снимок рабочего места. Свой формат для каждого браузера: webp
              вдвое легче, а jpg остаётся для тех, кто его не понимает.
              Обычный img, а не next/image: сборка статическая, оптимизатор
              выключен, и компонент дал бы только лишнюю обёртку. */}
          <div className="relative">
            <div
              className="pointer-events-none absolute -inset-6 rounded-[2rem] opacity-60 blur-2xl"
              style={{ background: "radial-gradient(60% 60% at 50% 40%, rgba(6,182,212,0.20), transparent 70%)" }}
            />
            <picture>
              <source srcSet="/broker/terminal.webp" type="image/webp" />
              <img
                src="/broker/terminal.jpg"
                alt={t.broker.hero.imageAlt}
                width={1600}
                height={840}
                loading="eager"
                className="relative w-full rounded-2xl border border-border shadow-card"
              />
            </picture>
          </div>
        </div>

        {/* Лестница уровней. Не таблица - четыре ступени в строку: их читают
            глазами за секунду, и видно, что ступень одна другой шире по
            обороту, а не по цене. */}
        <div className="mt-14 rounded-2xl border border-border bg-bg-card/40 p-5 backdrop-blur-sm md:mt-16 md:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              {t.broker.hero.ticker.label}
            </span>
            <span className="text-sm text-text-secondary">{t.broker.hero.ticker.note}</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CASHBACK_TIERS.map((tier, i) => (
              <div
                key={tier.id}
                className="relative overflow-hidden rounded-xl border border-border/70 bg-bg-panel/40 px-4 py-3"
              >
                <div className="font-mono text-2xl font-black tabular-nums text-accent-cyan">
                  {share(tier.share, locale)}
                </div>
                <div className="mt-0.5 text-xs text-text-muted">
                  {t.broker.hero.ticker.from} {compactMoney(tier.fromVolume, locale)}
                </div>
                {/* Полоска растёт со ступенью: сетка читается ещё до цифр. */}
                <div
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-accent-cyan/60"
                  style={{ width: `${((i + 1) / CASHBACK_TIERS.length) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
