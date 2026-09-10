"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import Reveal from "@/components/ui/Reveal";
import { weexRegisterUrl } from "@/lib/content";
import { useLocale, useT } from "@/lib/i18n";

/**
 * Последний экран.
 *
 * Единственное место страницы, где мы давим - и давим тем, что уже случилось:
 * комиссия за прошлый месяц уплачена и не вернётся. Ни таймеров, ни «осталось
 * три места»: на витрине про честный счёт выдуманная срочность стоила бы
 * дороже, чем принесла.
 */
export default function BrokerCta() {
  const t = useT();
  const locale = useLocale();

  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 md:px-6 md:pb-32">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-border bg-bg-card/85 p-8 text-center md:p-14">
          <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-60" />

          <div className="relative">
            <h2 className="text-h2 text-text-primary">{t.broker.cta.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-text-secondary">{t.broker.cta.text}</p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full bg-accent-cyan px-7 py-3 text-[15px] font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
              >
                {t.broker.cta.primary} <ArrowRight className="h-[15px] w-[15px]" />
              </Link>
              <a
                href={weexRegisterUrl(locale)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3 text-[15px] font-semibold text-text-primary transition-all duration-200 hover:bg-bg-panel/60 active:scale-[0.97]"
              >
                {t.broker.cta.secondary} <ExternalLink className="h-[14px] w-[14px] opacity-50" />
              </a>
            </div>

            <p className="mt-5 text-sm text-text-muted">{t.broker.cta.note}</p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
