"use client";

// Первый экран: что это и как выглядит.
//
// Раньше он начинался со спора - «это не сигналы», - и первое, что человек
// читал про нас, было отрицанием чужого. Теперь сразу имя терминала и то, чем
// он для трейдера является, а рядом его снимок: по картинке решают, читать ли
// дальше, и показывать её стоит до объяснений.

import Link from "next/link";
import { ArrowRight, Check, Send, Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n";
import SignupPicker from "@/components/landing/SignupPicker";

export default function Hero() {
  const t = useT();
  const copy = t.landing.hero;

  return (
    <section id="about" className="relative overflow-hidden pb-16 pt-28 md:pb-24 md:pt-32">
      <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-30 [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 md:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-12">
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
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-accent-cyan px-7 py-3 text-[15px] font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
            >
              {copy.ctaTerminal} <ArrowRight className="h-[15px] w-[15px]" />
            </Link>

            {/* Счёт на бирже: какой именно - человек выбирает в окне. */}
            <SignupPicker
              label={copy.ctaWeex}
              className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3 text-[15px] font-semibold text-text-primary transition-all duration-200 hover:border-border hover:bg-bg-panel/60 active:scale-[0.97]"
            />

            <a
              href="https://t.me/moneyhoney7_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-[15px] font-semibold text-text-secondary transition-all duration-200 hover:border-border hover:bg-bg-panel/60 hover:text-text-primary active:scale-[0.97]"
            >
              <Send className="h-4 w-4" /> Telegram
            </a>
          </div>
        </div>

        {/* Снимок рабочего места и под ним - что происходит внутри.
            Картинка первого экрана грузится сразу: отложенная, она въезжает
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

          <div className="relative mt-4 overflow-hidden rounded-2xl border border-accent-cyan/25 bg-bg-panel/95 p-5 backdrop-blur-2xl">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at top right, rgba(6,182,212,0.12) 0%, transparent 60%)",
              }}
            />
            <div className="relative flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/30">
                <Sparkles className="h-4 w-4" />
              </span>
              <p className="text-sm leading-relaxed text-text-primary">{copy.oneClick}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
