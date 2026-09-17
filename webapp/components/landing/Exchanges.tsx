"use client";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import PartnersTicker, { VenueCard } from "@/components/landing/PartnersTicker";
import { TRADING } from "@/lib/venues";
import { useT } from "@/lib/i18n";

/**
 * Партнёры: биржи, с которыми работает терминал.
 *
 * Вопрос «а где именно я буду торговать» человек задаёт раньше, чем читает
 * про стакан и сопровождение, - и до этого блока ответа на главной не было
 * вовсе.
 *
 * Сетка карточек отвечала на него списком, а лента отвечает видом: знаки идут
 * подряд и узнаются с одного взгляда - так показывают партнёрство, а не
 * перечень опций. Сама лента и её устройство - в `PartnersTicker`.
 *
 * Здесь только те биржи, где торговля уже идёт. Писать «скоро» под чужими
 * логотипами нельзя: это выглядит как партнёрство, которого нет.
 */

export default function Exchanges() {
  const t = useT();
  const copy = t.landing.exchanges;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      {/* Бирж пять, и на широком экране они помещаются в ряд целиком: лента
          там ехала мимо и резала знаки по краям, а ряд читается сразу и
          целиком. Телефону лента остаётся - пять карточек в столбик заняли бы
          пол-экрана. */}
      <Reveal delay={0.1}>
        <div className="mt-10 hidden gap-3 lg:grid lg:grid-cols-5">
          {TRADING.map((venue) => (
            <VenueCard key={venue.code} venue={venue} copy={copy} width="w-full" compact />
          ))}
        </div>
      </Reveal>

      <div className="mt-10 lg:hidden">
        <PartnersTicker />
      </div>
    </section>
  );
}
