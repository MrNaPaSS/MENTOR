"use client";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

/**
 * Путь до первой сделки.
 *
 * Четыре шага и время рядом с заголовком: главное возражение к смене площадки
 * не «сложно», а «долго и непонятно, чем кончится». Ответ - на сколько это
 * вообще затянется, поэтому «минут пятнадцать» стоит в заголовке раздела, а
 * не в конце последнего абзаца.
 */
export default function BrokerSteps() {
  const t = useT();

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow={t.broker.steps.eyebrow}
        title={t.broker.steps.title}
        subtitle={t.broker.steps.subtitle}
      />

      <div className="relative mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Линия связывает шаги в путь: без неё это четыре независимые
            карточки, и порядок читается не сразу. */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-10 hidden h-px lg:block"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(6,182,212,0.15) 20%, rgba(6,182,212,0.4) 50%, rgba(6,182,212,0.15) 80%, transparent)",
          }}
        />

        {t.broker.steps.items.map((step, i) => (
          <Reveal as="article" key={step.title} delay={i * 0.1}>
            <div className="relative h-full overflow-hidden rounded-2xl border border-border bg-bg-card/40 p-5">
              <span
                className="absolute right-4 top-2 select-none font-mono text-6xl font-black leading-none"
                style={{ color: "rgba(255,255,255,0.04)", WebkitTextStroke: "1px rgba(255,255,255,0.08)" }}
              >
                {`0${i + 1}`}
              </span>
              <span className="relative grid h-11 w-11 place-items-center rounded-xl bg-accent-cyan/10 font-mono text-lg font-black text-accent-cyan ring-1 ring-accent-cyan/25">
                {i + 1}
              </span>
              <h3 className="relative mt-4 font-bold text-text-primary">{step.title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-text-secondary">{step.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
