"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, Send } from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/content";

export default function Hero() {
  return (
    <section
      id="about"
      className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24"
    >
      <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-30 [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />

      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 md:px-6">
        <div className="max-w-3xl">
          <span className="badge-cyan animate-pulse-glow mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Работаем с 2023 · No Money No Honey
          </span>

          <h1 className="text-h1 text-white">
            <span className="glitch" data-text="Торгуй как профи.">
              Торгуй как профи.
            </span>
            <br />
            <span className="text-accent-cyan text-glow-cyan">Учись у лучших.</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg text-text-secondary">
            Персональные сигналы под твой депозит. Реальный расчёт. Реальный результат.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {/* Primary CTA */}
            <Link
              href="/login"
              className="inline-flex items-center gap-2.5 rounded-xl bg-accent-cyan px-8 py-3.5 text-base font-bold text-bg-deep shadow-[0_0_28px_rgba(10,255,224,0.28)] transition-all duration-200 hover:brightness-[0.93] hover:shadow-[0_0_40px_rgba(10,255,224,0.42)] active:scale-[0.97]"
            >
              Начать обучение <ArrowRight className="h-4 w-4" />
            </Link>

            {/* WEEX */}
            <a
              href={SOCIAL_LINKS.weexAffiliate}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-xl border border-white/[0.14] bg-white/[0.05] px-7 py-3.5 text-base font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:border-white/[0.26] hover:bg-white/[0.09] active:scale-[0.97]"
            >
              Открыть счёт WEEX <ExternalLink className="h-[15px] w-[15px] text-text-muted" />
            </a>

            {/* Telegram */}
            <a
              href={SOCIAL_LINKS.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3.5 text-base font-semibold text-text-secondary transition-all duration-200 hover:bg-white/[0.06] hover:text-white active:scale-[0.97]"
            >
              <Send className="h-4 w-4" /> Telegram
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
