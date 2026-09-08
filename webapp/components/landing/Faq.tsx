"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

/**
 * Тон вопроса. Не цвет, а имя: сам цвет берётся в globals.css - он разный на
 * тёмной и светлой теме, и метка красит им четыре вещи с разной прозрачностью.
 */
type Tone = "cyan" | "mint" | "violet" | "amber";

/** Тон каждого вопроса - по порядку, как они идут в словаре. */
const TONES: Tone[] = [
  "cyan", "cyan", "mint", "violet", "mint", "cyan", "violet", "amber", "mint",
];

export default function Faq() {
  const t = useT();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow={t.landing.faq.eyebrow}
        title={t.landing.faq.title}
        subtitle={t.landing.faq.subtitle}
      />

      <div className="mt-12 space-y-2.5">
        {t.landing.faq.items.map((f, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={i} delay={i * 0.04}>
              <div
                className="faq-item group overflow-hidden rounded-2xl border backdrop-blur-md"
                data-tone={TONES[i]}
                data-open={isOpen}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="flex flex-col gap-2 min-w-0">
                    {/* Tag */}
                    <span className="faq-tag inline-flex w-fit items-center rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      {f.tag}
                    </span>
                    <span className="font-semibold leading-snug text-text-primary">{f.q}</span>
                  </div>

                  {/* Chevron */}
                  <span className="faq-chevron mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {/* Answer */}
                <div
                  className="grid transition-all duration-300 ease-out"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="px-5 pb-5">
                      {/* Separator */}
                      <div className="faq-rule mb-4 h-px" />
                      <p className="text-sm leading-relaxed text-text-secondary">{f.a}</p>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/* CTA */}
      <Reveal delay={0.5}>
        <div
          className="faq-cta mt-10 flex flex-col items-center gap-4 rounded-2xl border p-6 text-center sm:flex-row sm:text-left"
        >
          <div className="flex-1">
            <p className="font-bold text-text-primary">{t.landing.faq.ctaTitle}</p>
            <p className="mt-1 text-sm text-text-secondary">
              {t.landing.faq.ctaText}
            </p>
          </div>
          <a
            href="https://t.me/+81HEkQveJic2YmEy"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-xl bg-accent-cyan px-5 py-2.5 text-sm font-bold text-bg-deep transition hover:brightness-110"
          >
            {t.landing.faq.ctaButton}
          </a>
        </div>
      </Reveal>
    </section>
  );
}
