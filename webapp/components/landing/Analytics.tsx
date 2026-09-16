"use client";

// Аналитика и прогресс: снимки кабинета, а не рассказ о нём.
//
// Раздел стоит после стека возможностей намеренно: там перечислено, что
// входит, а здесь показано, как это выглядит на самом деле.
//
// Раскладка та же, что на первом экране: слева текст, справа снимок. Ниже -
// две пары «текст и снимок» помельче: разбор дня и карточка за день. Порядок
// не случайный: сначала месяц целиком, потом один день внутри него, потом то,
// во что этот день сворачивается.
//
// Снимки из боевого кабинета, поэтому суммы счёта на них затёрты или не
// попали в кадр: это личные данные владельца, и показывать их ради красоты
// нельзя. Подпись под разделом обязательна и убрана быть не может - проценты
// в календаре считаются от залога сделки при большом плече, и человек должен
// прочитать об этом там же, где увидел цифры.

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
    <section id="analytics" className="mx-auto max-w-7xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-14 grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)] lg:gap-12">
        <div className="grid gap-4">
          {copy.points.map((point, i) => {
            const Icon = ICONS[i % ICONS.length];
            const accent = ACCENTS[i % ACCENTS.length];
            return (
              <Reveal key={point} delay={0.06 * i}>
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

        <Reveal delay={0.05}>
          <img
            src="/art/landing/analytics.webp"
            alt={copy.shotAlt}
            width={1600}
            height={903}
            loading="lazy"
            decoding="async"
            className="w-full rounded-2xl border border-white/[0.07] shadow-2xl"
          />
        </Reveal>
      </div>

      {/* День внутри месяца: текст слева, снимок справа - тем же порядком,
          что и выше, чтобы раздел читался одной колонкой сверху вниз. */}
      <div className="mt-16 grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)] lg:gap-12">
        <Reveal>
          <h3 className="text-h3 text-text-primary">{copy.dayTitle}</h3>
          <p className="mt-4 leading-relaxed text-text-secondary">{copy.dayText}</p>
        </Reveal>

        <Reveal delay={0.05}>
          <img
            src="/art/landing/analytics-day.webp"
            alt={copy.dayAlt}
            width={1200}
            height={916}
            loading="lazy"
            decoding="async"
            className="w-full rounded-2xl border border-white/[0.07] shadow-2xl"
          />
        </Reveal>
      </div>

      {/* Карточка стоит вертикально, и под неё отдана меньшая доля ряда: в
          ширину снимка выше она растянулась бы на весь экран. */}
      <div className="mt-16 grid items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-12">
        <Reveal>
          <h3 className="text-h3 text-text-primary">{copy.cardTitle}</h3>
          <p className="mt-4 leading-relaxed text-text-secondary">{copy.cardText}</p>
        </Reveal>

        <Reveal delay={0.05}>
          <img
            src="/art/landing/analytics-card.webp"
            alt={copy.cardAlt}
            width={760}
            height={1016}
            loading="lazy"
            decoding="async"
            className="mx-auto w-full max-w-sm rounded-2xl border border-white/[0.07] shadow-2xl"
          />
        </Reveal>
      </div>

      <Reveal delay={0.3}>
        <p className="mx-auto mt-12 max-w-3xl text-center text-xs leading-relaxed text-text-muted">{copy.honest}</p>
      </Reveal>
    </section>
  );
}
