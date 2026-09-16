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
// Снимки из боевого кабинета, поэтому суммы счёта на них затёрты: это личные
// данные владельца, и показывать их ради красоты нельзя. Оговорка про риск
// торговли с плечом живёт в подвале сайта, одна на все страницы.

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
      <SectionHeading eyebrow={copy.eyebrow} title={copy.advTitle} subtitle={copy.subtitle} />

      {/* Метрики: тот же порядок - текст слева, снимок справа. Под ним вторым
          рядом идёт детальный разбор, уже без своего заголовка: это тот же
          разговор, только с более мелкими цифрами. */}
      {/* Верхний ряд: текст слева, снимок справа. Нижний - зеркально, и
          описание разведено по рядам: у каждого снимка своя подпись, иначе
          второй остаётся картинкой без объяснения. */}
      <div className="mt-14 grid items-center gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)] lg:gap-12">
        <Reveal>
          <p className="leading-relaxed text-text-secondary">{copy.advText}</p>
        </Reveal>

        <Reveal delay={0.05}>
          <img
            src="/art/landing/analytics-advanced.webp"
            alt={copy.advAlt}
            width={1600}
            height={901}
            loading="lazy"
            decoding="async"
            className="w-full rounded-2xl border border-white/[0.07] shadow-2xl"
          />
        </Reveal>
      </div>

      <div className="mt-12 grid items-center gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)] lg:gap-12">
        <Reveal delay={0.05}>
          <img
            src="/art/landing/analytics-detail.webp"
            alt={copy.detAlt}
            width={1600}
            height={901}
            loading="lazy"
            decoding="async"
            className="w-full rounded-2xl border border-white/[0.07] shadow-2xl"
          />
        </Reveal>

        <Reveal>
          <p className="leading-relaxed text-text-secondary">{copy.detText}</p>
        </Reveal>
      </div>

    </section>
  );
}
