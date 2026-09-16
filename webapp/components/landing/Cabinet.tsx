"use client";

// Кабинет: один раздел вместо трёх.
//
// Раньше аналитика, сертификат и витрина фактов шли подряд тремя длинными
// разворотами - четыре снимка в столбик, каждый со своим заголовком. По
// отдельности блоки были ничего, вместе превращали страницу в ленту
// скриншотов, по которой глаз просто съезжает вниз.
//
// Здесь то же самое одним блоком: крупный снимок кабинета и под ним четыре
// плитки - день, метрики, карточка, сертификат. Подписи короткие: на плитке
// всё видно и так, а длинный текст рядом со снимком его же и заслоняет.
//
// Плитки одной высоты и с обрезкой по верху: снимки у нас разных пропорций, и
// показывать каждый целиком значит получить рваный ряд. Нужен ровный ряд, а
// подробности человек увидит в самом кабинете.

/* eslint-disable @next/next/no-img-element */

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

export default function Cabinet() {
  const t = useT();
  const copy = t.landing.cabinet;

  return (
    <section id="cabinet" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <Reveal delay={0.05}>
        <img
          src="/art/landing/analytics.webp"
          alt={copy.shotAlt}
          width={1600}
          height={903}
          loading="lazy"
          decoding="async"
          className="mt-14 w-full rounded-2xl border border-white/[0.07] shadow-2xl"
        />
      </Reveal>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {copy.tiles.map((tile, i) => (
          <Reveal as="article" key={tile.title} delay={0.06 * i}>
            <figure className="group m-0 h-full overflow-hidden rounded-2xl border border-border bg-bg-panel/95 backdrop-blur-2xl transition-all duration-500 hover:-translate-y-1.5 hover:shadow-2xl">
              <div className="h-40 overflow-hidden border-b border-border bg-bg-deep/40">
                <img
                  src={tile.src}
                  alt={tile.alt}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.04]"
                />
              </div>

              <figcaption className="p-5">
                <h3 className="text-base font-bold text-text-primary">{tile.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{tile.text}</p>
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
