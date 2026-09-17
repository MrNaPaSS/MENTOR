"use client";

// Первый экран: что это и как выглядит.
//
// Раньше он начинался со спора - «это не сигналы», - и первое, что человек
// читал про нас, было отрицанием чужого. Теперь сразу имя терминала и то, чем
// он для трейдера является, а рядом его снимок: по картинке решают, читать ли
// дальше, и показывать её стоит до объяснений.

import { ArrowRight, Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import SignupPicker from "@/components/landing/SignupPicker";
import { SOCIAL_LINKS } from "@/lib/content";

export default function Hero() {
  const t = useT();
  const copy = t.landing.hero;

  return (
    <section id="about" className="relative overflow-hidden pb-16 pt-24 md:pb-20 md:pt-28">
      <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-30 [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />

      {/* Снимок справа от текста, и колонка под него шире текстовой.
          Пропорции разные по ширине экрана: на широком картинка забирает
          полтора места к одному, а около 1280 колонки почти равны - иначе имя
          терминала в заголовке не помещается в свою колонку и подлезает под
          снимок. За край экрана снимок не уходит: правую часть баннера
          занимает сам терминал, и обрезать надо что угодно, только не его. */}
      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 md:px-6 xl:max-w-[86rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.43fr)]">
        <div>
          <span className="eyebrow">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan shadow-glow-cyan" />
            {copy.eyebrow}
          </span>

          <h1 className="mt-4 text-h1 text-text-primary">
            <span className="glitch" data-text={copy.titleTop}>
              {copy.titleTop}
            </span>
            <br />
            <span className="text-accent-cyan text-glow-cyan">{copy.titleAccent}</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg text-text-secondary">{copy.lead}</p>

          {/* Три возражения, которые снимаются до первого клика. */}
          <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-text-muted">
            {copy.bullets.map((item) => (
              <li key={item} className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-accent-cyan" />
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={SOCIAL_LINKS.academy}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-accent-cyan px-5 py-2.5 text-sm font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
            >
              {copy.ctaTerminal} <ArrowRight className="h-[15px] w-[15px]" />
            </a>

            {/* Счёт на бирже: какой именно - человек выбирает в окне. */}
            <SignupPicker
              label={copy.ctaWeex}
              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-text-primary transition-all duration-200 hover:border-border hover:bg-bg-panel/60 active:scale-[0.97]"
            />

          </div>
        </div>

        {/* Картинка первого экрана грузится сразу: отложенная, она въезжает
            на глазах у человека и дёргает раскладку. */}
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art/seo/terminal-cover.webp"
            alt={copy.shotAlt}
            width={1600}
            height={900}
            loading="eager"
            // @ts-expect-error - атрибут браузера, в типах React его ещё нет
            fetchpriority="high"
            decoding="async"
            className="w-full rounded-2xl border border-white/[0.07] shadow-2xl"
          />

          <p className="mt-5 max-w-3xl text-sm leading-relaxed text-text-muted">{copy.oneClick}</p>
        </div>
      </div>
    </section>
  );
}
