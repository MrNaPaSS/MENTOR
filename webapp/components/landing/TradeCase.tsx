"use client";

// Одна сделка целиком: вход, ход и чем кончилась.
//
// Раздел выше объясняет терминал словами, а этот показывает его за работой -
// теми же снимками, что трейдер видел у себя на экране. Сделка настоящая, с
// биржи: плита в стакане на сопротивлении, шорт от неё по структуре, стоп в
// безубыток, выход и карточка результата.
//
// Показан один шаг, остальные листаются. Три снимка подряд занимали три
// экрана, и до карточки результата пролистывали не глядя; а разглядывать
// стоит каждый - на нём и стакан, и разметка, и цели.
//
// Заканчивается раздел двумя карточками рядом: наша и биржевая. Тот же довод,
// что и в витрине ниже, но на сделке, которую человек только что прочитал.

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

/** Снимки шагов. Порядок здесь - порядок самой сделки. */
const SHOTS = [
  "/showcase/case/01-entry.webp",
  "/showcase/case/02-run.webp",
  "/showcase/case/03-exit.webp",
] as const;

export default function TradeCase() {
  const t = useT();
  const copy = t.landing.tradeCase;
  const [step, setStep] = useState(0);

  // По кругу: с последнего шага вперёд - снова на вход. Тупик в конце ленты
  // читается как поломка, а сделку часто пересматривают со второго захода.
  const go = (delta: number) => setStep((now) => (now + delta + SHOTS.length) % SHOTS.length);
  const current = copy.steps[step];

  return (
    <section id="case" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <Reveal delay={0.05}>
        <div className="mt-12">
          {/* Шаги названиями, а не точками: по «Плита на сопротивлении» видно,
              куда ведёт кнопка, а по кружку - нет. На телефоне остаются номера:
              три названия в строку там не помещаются. */}
          <div className="flex flex-wrap items-center gap-2">
            {copy.steps.map((s, i) => (
              <button
                key={s.title}
                onClick={() => setStep(i)}
                aria-current={i === step}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                  i === step
                    ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                    : "border-border bg-bg-panel/60 text-text-secondary hover:text-text-primary"
                }`}
              >
                <span className="font-mono">{i + 1}</span>
                <span className="ml-2 hidden sm:inline">{s.title}</span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => go(-1)}
                title={copy.prev}
                aria-label={copy.prev}
                className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-secondary transition-colors duration-200 hover:border-accent-cyan/40 hover:text-accent-cyan"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => go(1)}
                title={copy.next}
                aria-label={copy.next}
                className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-secondary transition-colors duration-200 hover:border-accent-cyan/40 hover:text-accent-cyan"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Снимок во всю ширину: на графике важны и стакан, и разметка, и
              подписи целей - в половину ширины их пришлось бы разглядывать.
              Все три лежат друг на друге, показан один: так при листании не
              прыгает высота раздела и не мигает незагруженная картинка. */}
          <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/[0.07] shadow-2xl">
            {SHOTS.map((src, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={src}
                src={src}
                alt={copy.steps[i].title}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                width={1440}
                height={899}
                aria-hidden={i !== step}
                className={`w-full transition-opacity duration-300 ${
                  i === step ? "opacity-100" : "absolute inset-0 opacity-0"
                }`}
              />
            ))}
          </div>

          <div className="mt-5 flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-cyan/10 font-mono text-sm font-bold text-accent-cyan ring-1 ring-accent-cyan/30">
              {step + 1}
            </span>
            <div className="max-w-3xl">
              <h3 className="text-lg font-bold text-text-primary">{current.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{current.text}</p>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {[
            { src: "/showcase/case/04-card-nmnh.jpg", label: copy.cardOurs, accent: true },
            { src: "/showcase/case/05-card-weex.jpg", label: copy.cardTheirs, accent: false },
          ].map((card) => (
            <figure key={card.src} className="m-0">
              <figcaption
                className={`mb-3 text-xs font-bold uppercase tracking-[0.2em] ${
                  card.accent ? "text-accent-cyan" : "text-text-muted"
                }`}
              >
                {card.label}
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.src}
                alt={card.label}
                loading="lazy"
                decoding="async"
                className={`w-full rounded-2xl border border-border shadow-[0_8px_32px_rgba(0,0,0,0.4)] ${
                  card.accent ? "" : "opacity-70"
                }`}
              />
            </figure>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
