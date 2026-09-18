"use client";

// Страница подписки целиком: первый экран, тарифы, сравнение, пробный период,
// оплата, вопросы и призыв.
//
// Собрана одним компонентом намеренно: разделы короткие, живут только здесь и
// ссылаются друг на друга по смыслу. Разносить их по файлам стоит тогда, когда
// какой-то из них понадобится на второй странице.
//
// Главная мысль раскладки: бесплатный путь стоит первой колонкой и выглядит
// как полноценный тариф, а не как «раньше было бесплатно». Человек должен
// видеть, что прежняя дорога никуда не делась, просто подходит не всем.

import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clock,
  Minus,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import SignupPicker from "@/components/landing/SignupPicker";
import { SOCIAL_LINKS } from "@/lib/content";
import { useT } from "@/lib/i18n";

/** Значение в таблице: галочка, прочерк или своя подпись вроде «за монеты». */
function Cell({ value, yes, no }: { value: boolean | string; yes: string; no: string }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-400">
        <Check className="h-4 w-4" />
        <span className="sr-only">{yes}</span>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-text-muted">
        <Minus className="h-4 w-4" />
        <span className="sr-only">{no}</span>
      </span>
    );
  }
  return <span className="text-sm font-semibold text-text-primary">{value}</span>;
}

export default function PricingPage() {
  const t = useT();
  const copy = t.landing;
  const p = t.pricing;

  return (
    <>
      {/* Шапка своя и короткая: на этой странице некуда вести по якорям, а
          главная нужна как выход. */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg-deep/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="text-lg font-black tracking-tight text-text-primary">
            NMNH<span className="text-accent-cyan">.TRADE</span>
          </Link>

          <nav className="flex items-center gap-5 text-sm text-text-secondary">
            <a href="#plans" className="hidden hover:text-text-primary sm:inline">
              {p.nav.plans}
            </a>
            <a href="#compare" className="hidden hover:text-text-primary sm:inline">
              {p.nav.compare}
            </a>
            <a href="#faq" className="hidden hover:text-text-primary sm:inline">
              {p.nav.faq}
            </a>
            <Link
              href="/"
              className="rounded-full border border-border px-4 py-2 font-semibold text-text-primary transition-colors hover:bg-bg-panel/60"
            >
              {p.nav.back}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Первый экран как на главной: текст слева, снимок рабочего места
            справа и шире текстовой колонки. */}
        <section className="relative overflow-hidden pb-14 pt-16 md:pb-16 md:pt-20">
          <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-70" />

          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-12">
            <div className="order-2 lg:order-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/art/seo/terminal-cover.webp"
                alt={p.hero.shotAlt}
                width={1600}
                height={900}
                loading="eager"
                // @ts-expect-error - атрибут браузера, в типах React его ещё нет
                fetchpriority="high"
                decoding="async"
                className="w-full rounded-2xl border border-white/[0.07] shadow-2xl"
              />
            </div>

            <div className="order-1 lg:order-1">
              <span className="eyebrow">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan shadow-glow-cyan" />
                {p.hero.eyebrow}
              </span>

              <h1 className="mt-4 text-h2 text-text-primary md:text-h1">
                {p.hero.titleTop}
                <br />
                <span className="text-accent-cyan text-glow-cyan">{p.hero.titleAccent}</span>
              </h1>

              <p className="mt-5 text-lg text-text-secondary">{p.hero.lead}</p>

              <ul className="mt-6 space-y-2 text-sm text-text-muted">
                {p.hero.bullets.map((item) => (
                  <li key={item} className="inline-flex w-full items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-accent-cyan" />
                    {item}
                  </li>
                ))}
              </ul>

              {/* Главная кнопка - бесплатный путь: он и есть основная дорога.
                  Подписка стоит рядом второй и ведёт к тарифам. */}
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <SignupPicker
                  label={p.hero.cta}
                  className="inline-flex items-center gap-2 rounded-full bg-accent-cyan px-6 py-3 text-sm font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
                />

                <a
                  href="#plans"
                  className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold text-text-primary transition-all duration-200 hover:bg-bg-panel/60 active:scale-[0.97]"
                >
                  {p.hero.ctaSecondary} <ArrowRight className="h-[15px] w-[15px]" />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="plans" className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
          <SectionHeading eyebrow={p.plans.eyebrow} title={p.plans.title} subtitle={p.plans.subtitle} />

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {/* Бесплатный путь */}
            <Reveal as="article">
              <div className="flex h-full flex-col rounded-3xl border border-border bg-bg-panel/95 p-7 backdrop-blur-2xl">
                <h3 className="text-lg font-bold text-text-primary">{p.plans.free.name}</h3>
                <p className="mt-1 text-sm text-text-muted">{p.plans.free.hint}</p>

                <div className="mt-6 flex items-end gap-2">
                  <span className="font-mono text-5xl font-black leading-none text-text-primary">
                    {p.plans.free.price}
                  </span>
                  <span className="pb-1 text-sm text-text-muted">{p.plans.perMonth}</span>
                </div>
                <p className="mt-2 text-xs text-text-muted">{p.plans.free.priceNote}</p>

                <ul className="mt-7 flex-1 space-y-3">
                  {p.plans.free.features.map((line) => (
                    <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      {line}
                    </li>
                  ))}
                </ul>

                <SignupPicker
                  label={p.plans.free.cta}
                  className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold text-text-primary transition-all duration-200 hover:bg-bg-panel/60 active:scale-[0.97]"
                />
              </div>
            </Reveal>

            {/* Базовая подписка: выделена рамкой - это тариф, ради которого
                страница и существует. */}
            <Reveal as="article" delay={0.08}>
              <div className="relative flex h-full flex-col rounded-3xl border border-accent-cyan/40 bg-bg-panel/95 p-7 shadow-[0_20px_60px_-25px_rgba(6,182,212,0.45)] backdrop-blur-2xl">
                <span className="absolute -top-3 left-7 rounded-full bg-accent-cyan px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-bg-deep">
                  {p.plans.base.badge}
                </span>

                <h3 className="text-lg font-bold text-text-primary">{p.plans.base.name}</h3>
                <p className="mt-1 text-sm text-text-muted">{p.plans.base.hint}</p>

                <div className="mt-6 flex items-end gap-2">
                  <span className="font-mono text-5xl font-black leading-none text-accent-cyan">
                    {p.plans.base.price}
                  </span>
                  <span className="pb-1 text-sm text-text-muted">{p.plans.perMonth}</span>
                </div>
                <p className="mt-2 text-xs text-text-muted">{p.plans.base.priceNote}</p>

                <ul className="mt-7 flex-1 space-y-3">
                  {p.plans.base.features.map((line) => (
                    <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan" />
                      {line}
                    </li>
                  ))}
                </ul>

                <a
                  href={SOCIAL_LINKS.academyBot}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent-cyan px-6 py-3 text-sm font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
                >
                  {p.plans.base.cta} <ArrowRight className="h-[15px] w-[15px]" />
                </a>
              </div>
            </Reveal>

            {/* Старший тариф */}
            <Reveal as="article" delay={0.16}>
              <div className="flex h-full flex-col rounded-3xl border border-amber-400/30 bg-bg-panel/95 p-7 backdrop-blur-2xl">
                <h3 className="text-lg font-bold text-text-primary">{p.plans.pro.name}</h3>
                <p className="mt-1 text-sm text-text-muted">{p.plans.pro.hint}</p>

                <div className="mt-6 flex items-end gap-2">
                  <span className="font-mono text-5xl font-black leading-none text-amber-400">
                    {p.plans.pro.price}
                  </span>
                  <span className="pb-1 text-sm text-text-muted">{p.plans.perMonth}</span>
                </div>
                <p className="mt-2 text-xs text-text-muted">{p.plans.pro.priceNote}</p>

                <ul className="mt-7 flex-1 space-y-3">
                  {p.plans.pro.features.map((line) => (
                    <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      {line}
                    </li>
                  ))}
                </ul>

                <a
                  href={SOCIAL_LINKS.academyBot}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full border border-amber-400/40 px-6 py-3 text-sm font-semibold text-text-primary transition-all duration-200 hover:bg-amber-400/10 active:scale-[0.97]"
                >
                  {p.plans.pro.cta}
                </a>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="compare" className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
          <SectionHeading eyebrow={p.compare.eyebrow} title={p.compare.title} />

          <Reveal delay={0.05}>
            <div className="mt-12 overflow-hidden rounded-3xl border border-border bg-bg-panel/95 backdrop-blur-2xl">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-4 text-sm font-semibold text-text-muted md:px-7" />
                    <th className="px-3 py-4 text-center text-sm font-semibold text-text-primary">
                      {p.compare.columns.free}
                    </th>
                    <th className="px-3 py-4 text-center text-sm font-semibold text-accent-cyan">
                      {p.compare.columns.base}
                    </th>
                    <th className="px-3 py-4 text-center text-sm font-semibold text-amber-400">
                      {p.compare.columns.pro}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {p.compare.rows.map((row) =>
                    "group" in row ? (
                      // Разделитель раздела: сорок строк подряд читаются как
                      // простыня, а заголовки дают глазу опору и заодно
                      // показывают, из чего состоит продукт.
                      <tr key={row.group} className="border-y border-border bg-bg-deep/60">
                        <td colSpan={4} className="px-5 py-4 md:px-7">
                          <span className="inline-flex items-center gap-2.5">
                            <span className="h-3.5 w-1 rounded-full bg-accent-cyan" />
                            <span className="text-[13px] font-bold uppercase tracking-[0.16em] text-text-primary">
                              {row.group}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.label} className="border-b border-border/60 last:border-0">
                        <td className="px-5 py-3.5 text-sm text-text-secondary md:px-7">{row.label}</td>
                        <td className="px-3 py-3.5 text-center">
                          <Cell value={row.free} yes={p.compare.yes} no={p.compare.no} />
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <Cell value={row.base} yes={p.compare.yes} no={p.compare.no} />
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <Cell value={row.pro} yes={p.compare.yes} no={p.compare.no} />
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </Reveal>
        </section>

        {/* Пробный период и оплата стоят парой: первое отвечает «что я теряю,
            если не подойдёт», второе - «как с меня возьмут деньги». Оба
            вопроса человек задаёт до того, как нажмёт кнопку. */}
        <section className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
          <div className="grid gap-5 lg:grid-cols-2">
            {[
              { block: p.trial, Icon: Clock, accent: "text-accent-cyan", ring: "ring-cyan-500/30 bg-cyan-500/10" },
              { block: p.billing, Icon: Wallet, accent: "text-amber-400", ring: "ring-amber-500/30 bg-amber-500/10" },
            ].map(({ block, Icon, accent, ring }) => (
              <Reveal as="article" key={block.title}>
                <div className="h-full rounded-3xl border border-border bg-bg-panel/95 p-7 backdrop-blur-2xl md:p-9">
                  <span className={`grid h-12 w-12 place-items-center rounded-2xl ring-1 ${ring} ${accent}`}>
                    <Icon className="h-6 w-6" />
                  </span>

                  <span className="mt-5 block text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                    {block.eyebrow}
                  </span>
                  <h3 className="mt-2 text-h3 text-text-primary">{block.title}</h3>
                  <p className="mt-4 leading-relaxed text-text-secondary">{block.text}</p>

                  <ul className="mt-6 space-y-3">
                    {block.points.map((line) => (
                      <li key={line} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
                        <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current ${accent}`} />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-4xl px-4 py-14 md:px-6 md:py-20">
          <SectionHeading eyebrow={p.faq.eyebrow} title={p.faq.title} />

          <div className="mt-12 space-y-4">
            {p.faq.items.map((item, i) => (
              <Reveal as="article" key={item.q} delay={i * 0.05}>
                <details className="group rounded-2xl border border-border bg-bg-panel/95 p-5 backdrop-blur-2xl md:p-6">
                  <summary className="cursor-pointer list-none font-semibold text-text-primary marker:hidden">
                    {item.q}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-text-secondary">{item.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-20 md:px-6 md:pb-28">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-accent-cyan/25 bg-bg-panel/95 p-8 text-center backdrop-blur-2xl md:p-12">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent-cyan/10 blur-3xl"
              />

              <div className="relative">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/30 mx-auto">
                  <ShieldCheck className="h-6 w-6" />
                </span>

                <h2 className="mt-5 text-h2 text-text-primary">{p.cta.title}</h2>
                <p className="mx-auto mt-4 max-w-xl text-text-secondary">{p.cta.text}</p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <SignupPicker
                    label={p.cta.primary}
                    className="inline-flex items-center gap-2 rounded-full bg-accent-cyan px-7 py-3 text-sm font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
                  />

                  <a
                    href={SOCIAL_LINKS.academyBot}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3 text-sm font-semibold text-text-primary transition-all duration-200 hover:bg-bg-panel/60 active:scale-[0.97]"
                  >
                    {p.cta.secondary}
                  </a>
                </div>

                <p className="mt-6 text-xs text-text-muted">{copy.footer.disclaimer}</p>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
    </>
  );
}
