"use client";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { SOCIAL_LINKS } from "@/lib/content";
import { useT } from "@/lib/i18n";

/**
 * Куда идти читать дальше: канал и академия.
 *
 * Вместо одинакового значка мессенджера у обоих - их собственные аватары, те
 * же, что человек увидит в списке чатов, когда перейдёт. Значок отвечал на
 * вопрос «где это», аватар отвечает на вопрос «куда именно»: два входа в один
 * и тот же Telegram различаются только этим.
 */
const SOCIALS = [
  { key: "channel", href: SOCIAL_LINKS.telegram, image: "/socials/channel" },
  { key: "academy", href: SOCIAL_LINKS.academyBot, image: "/socials/academy" },
] as const;

export default function Socials() {
  const t = useT();

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={t.landing.socials.eyebrow} title={t.landing.socials.title} />

      <div className="mt-12 flex flex-wrap justify-center gap-5">
        {SOCIALS.map((s, i) => (
          <Reveal key={s.key} delay={i * 0.1}>
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex w-56 flex-col items-center gap-5 rounded-2xl border border-border bg-bg-panel/80 p-7 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-[#229ED9]/50"
            >
              {/* Аватар кружком, как в самом мессенджере. Свой формат каждому
                  браузеру: webp легче, jpg остаётся запасным. */}
              <picture>
                <source srcSet={`${s.image}.webp`} type="image/webp" />
                <img
                  src={`${s.image}.jpg`}
                  alt=""
                  width={320}
                  height={320}
                  loading="lazy"
                  className="h-24 w-24 rounded-full object-cover ring-1 ring-border transition duration-300 group-hover:scale-105 group-hover:ring-[#229ED9]/50"
                />
              </picture>

              <div className="text-base font-bold tracking-widest text-text-primary">
                {t.landing.socials[s.key]}
              </div>
            </a>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
