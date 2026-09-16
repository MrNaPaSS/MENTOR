"use client";

// Аналитика и прогресс: снимок кабинета, а не рассказ о нём.
//
// Раздел стоит после стека возможностей намеренно: там перечислено, что
// входит, а здесь показано, как это выглядит на самом деле. Снимок - из
// боевого кабинета, поэтому суммы счёта на нём затёрты: это личные данные
// владельца, и показывать их ради красоты нельзя.
//
// Подпись под снимком обязательна и убрана быть не может. Проценты в
// календаре считаются от залога сделки при большом плече, и человек должен
// прочитать об этом там же, где увидел цифры, а не в подвале страницы.

/* eslint-disable @next/next/no-img-element */

import { CalendarDays, Flag, Target, TrendingUp, type LucideIcon } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import GlowCard, { CardIcon, type CardAccent } from "@/components/ui/GlowCard";
import { useT } from "@/lib/i18n";

const ICONS: LucideIcon[] = [CalendarDays, TrendingUp, Flag, Target];
const ACCENTS: CardAccent[] = ["cyan", "green", "gold", "violet"];

export default function Analytics() {
  const t = useT();
  const copy = t.landing.analytics;

  return (
    <section id="analytics" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <Reveal delay={0.05}>
        <img
          src="/art/landing/analytics.webp"
          alt={copy.shotAlt}
          width={1600}
          height={903}
          loading="lazy"
          decoding="async"
          className="mt-12 w-full rounded-2xl border border-white/[0.07] shadow-2xl"
        />
      </Reveal>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {copy.points.map((point, i) => {
          const Icon = ICONS[i % ICONS.length];
          const accent = ACCENTS[i % ACCENTS.length];
          return (
            <Reveal key={point} delay={0.08 * i}>
              <GlowCard accent={accent}>
                <div className="flex gap-4">
                  <CardIcon accent={accent}>
                    <Icon className="h-6 w-6" />
                  </CardIcon>
                  <p className="flex-1 self-center text-sm leading-relaxed text-text-secondary">{point}</p>
                </div>
              </GlowCard>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.3}>
        <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-relaxed text-text-muted">{copy.honest}</p>
      </Reveal>
    </section>
  );
}
