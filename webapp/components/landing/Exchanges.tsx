"use client";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

/**
 * Биржи, с которыми работает терминал.
 *
 * Вопрос «а где именно я буду торговать» человек задаёт раньше, чем читает про
 * стакан и сопровождение, - и до этого блока ответа на главной не было вовсе.
 *
 * Показываем знаки бирж, а не список названий: свою биржу человек узнаёт по
 * знаку быстрее, чем прочитает слово. Знаки те же, что в кабинете на карточке
 * счёта, - узнавание должно работать в обе стороны.
 *
 * Здесь только те три, где торговля уже идёт. Писать «скоро» под чужими
 * логотипами нельзя: это выглядит как партнёрство, которого нет, - число
 * остальных названо словами в подписи.
 */
const LIVE = [
  { code: "weex", name: "WEEX", mark: "/art/brand/weex-mark.webp", glow: "art-glow" },
  { code: "okx", name: "OKX", mark: "/art/brand/okx-mark.webp", glow: "mark-ink" },
  { code: "bingx", name: "BingX", mark: "/art/brand/bingx-mark.webp", glow: "art-glow-blue" },
] as const;

export default function Exchanges() {
  const t = useT();
  const copy = t.landing.exchanges;

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {LIVE.map((one, i) => (
          <Reveal key={one.code} delay={i * 0.1}>
            <div className="flex h-full flex-col items-center gap-4 rounded-2xl border border-border bg-bg-panel/60 p-6 text-center backdrop-blur-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={one.mark}
                alt={one.name}
                loading="lazy"
                decoding="async"
                className={`h-12 w-auto max-w-[140px] object-contain ${one.glow}`}
              />
              <div>
                <p className="font-bold text-text-primary">{one.name}</p>
                <p className="mt-1 text-[13px] text-text-muted">{copy.live}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.3}>
        <p className="mt-6 text-center text-sm text-text-muted">{copy.note}</p>
      </Reveal>
    </section>
  );
}
