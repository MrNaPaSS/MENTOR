"use client";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import PartnersTicker from "@/components/landing/PartnersTicker";
import { PENDING } from "@/lib/venues";
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
 * логотипами нельзя: это выглядит как партнёрство, которого нет, - число
 * остальных названо словами в подписи. Считается оно от того же реестра
 * (`lib/venues.ts`), что и сама лента: «2 в ожидании» под пятью
 * подключёнными читалось бы как ошибка терминала.
 */

export default function Exchanges() {
  const t = useT();
  const copy = t.landing.exchanges;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-10">
        <PartnersTicker />
      </div>

      <Reveal delay={0.3}>
        <p className="mt-6 text-center text-sm text-text-muted">{copy.note(PENDING)}</p>
      </Reveal>
    </section>
  );
}
