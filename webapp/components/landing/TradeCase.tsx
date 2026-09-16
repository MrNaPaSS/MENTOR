"use client";

// Одна сделка целиком: вход, ведение, выход и запись в журнале.
//
// Это единственное доказательство на всей странице, и потому оно стоит сразу
// после рассказа о рабочем месте. Всё остальное можно заявить словами - а
// снимок из терминала либо есть, либо его нет.
//
// Шаги чередуются сторонами: снимок и текст меняются местами через один. Три
// одинаково сложенных блока подряд глаз пролистывает как один, а чередование
// заставляет остановиться на каждом.
//
// Пара карточек в конце - самое сильное место раздела. Она доказывает не
// доход, а совпадение с отчётом биржи, и опытный человек читает это мгновенно.

/* eslint-disable @next/next/no-img-element */

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

export default function TradeCase() {
  const t = useT();
  const copy = t.landing.proof;

  return (
    <section id="proof" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-14 space-y-8 md:space-y-14">
        {copy.steps.map((step, i) => (
          <Reveal as="article" key={step.title} delay={0.05}>
            {/* Под снимок отдана большая доля ряда: подпись - это номер и
                название, объяснять шаг словами здесь нечего. Смотреть надо на
                экран терминала, а не читать про него. */}
            <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-10">
              <figure className={`m-0 ${i % 2 === 1 ? "md:order-2" : ""}`}>
                <img
                  src={step.src}
                  alt={step.alt}
                  loading="lazy"
                  decoding="async"
                  className="w-full rounded-2xl border border-white/[0.07] shadow-2xl"
                />
              </figure>

              <div className={i % 2 === 1 ? "md:order-1" : ""}>
                <span
                  aria-hidden
                  className="block font-mono text-5xl font-black leading-none text-accent-cyan opacity-30"
                >
                  {`0${i + 1}`}
                </span>
                <h3 className="mt-3 text-h3 text-text-primary">{step.title}</h3>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      {/* Карточки парой и не шире текста: во всю ширину страницы они
          превращаются в обои, а смысл пары в том, чтобы глаз сравнил числа. */}
      <Reveal delay={0.1}>
        <div className="mx-auto mt-14 max-w-2xl">
          <div className="grid grid-cols-2 gap-3 sm:gap-5">
            <figure className="m-0">
              <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-cyan sm:text-[11px] sm:tracking-[0.18em]">
                {copy.cards.ours}
              </figcaption>
              <img
                src={copy.cards.oursSrc}
                alt={copy.cards.oursAlt}
                loading="lazy"
                decoding="async"
                className="w-full rounded-2xl border border-border bg-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
              />
            </figure>

            <figure className="m-0">
              <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted sm:text-[11px] sm:tracking-[0.18em]">
                {copy.cards.theirs}
              </figcaption>
              <img
                src={copy.cards.theirsSrc}
                alt={copy.cards.theirsAlt}
                loading="lazy"
                decoding="async"
                className="w-full rounded-2xl border border-border bg-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
              />
            </figure>
          </div>

          <p className="mt-4 text-center text-sm leading-relaxed text-text-muted">{copy.cards.note}</p>
        </div>
      </Reveal>
    </section>
  );
}
