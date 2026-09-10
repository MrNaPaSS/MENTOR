"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { SOCIAL_LINKS } from "@/lib/content";
import { useT } from "@/lib/i18n";

/** Тон метки - только чтобы список не читался сплошняком. Цвета - в globals.css. */
const TONES = ["cyan", "mint", "cyan", "violet", "amber", "mint", "amber", "violet", "cyan"];

/**
 * Вопросы, которые обычно прячут.
 *
 * Порядок выбран от неудобного к спокойному: первым идёт «в чём подвох», а не
 * «как начать». Человек, пришедший с подписочной витрины, всё равно читает
 * страницу с этого вопроса - разница лишь в том, найдёт он ответ или додумает
 * его сам.
 *
 * Тот же список уходит в разметку страницы для поисковика, поэтому текст здесь
 * обязан совпадать с видимым слово в слово.
 */
export default function BrokerFaq() {
  const t = useT();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow={t.broker.faq.eyebrow}
        title={t.broker.faq.title}
        subtitle={t.broker.faq.subtitle}
      />

      <div className="mt-12 space-y-2.5">
        {t.broker.faq.items.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={item.q} delay={i * 0.04}>
              <div
                className="faq-item group overflow-hidden rounded-2xl border backdrop-blur-md"
                data-tone={TONES[i % TONES.length]}
                data-open={isOpen}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="flex min-w-0 flex-col gap-2">
                    <span className="faq-tag inline-flex w-fit items-center rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      {item.tag}
                    </span>
                    <span className="font-semibold leading-snug text-text-primary">{item.q}</span>
                  </div>
                  <span className="faq-chevron mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                <div
                  className="grid transition-all duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="px-5 pb-5">
                      <div className="faq-rule mb-4 h-px" />
                      <p className="text-sm leading-relaxed text-text-secondary">{item.a}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.5}>
        <div className="faq-cta mt-10 flex flex-col items-center gap-4 rounded-2xl border p-6 text-center sm:flex-row sm:text-left">
          <div className="flex-1">
            <p className="font-bold text-text-primary">{t.broker.faq.ctaTitle}</p>
            <p className="mt-1 text-sm text-text-secondary">{t.broker.faq.ctaText}</p>
          </div>
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-xl bg-accent-cyan px-5 py-2.5 text-sm font-bold text-bg-deep transition hover:brightness-110"
          >
            {t.broker.faq.ctaButton}
          </a>
        </div>
      </Reveal>
    </section>
  );
}
