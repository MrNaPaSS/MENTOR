"use client";

import Link from "next/link";
import { ArrowRight, Check, ExternalLink, Send } from "lucide-react";
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
          <span className="eyebrow">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan shadow-glow-cyan" />
            Торговый терминал академии NMNH
          </span>

          <h1 className="mt-4 text-h1 text-text-primary">
            <span className="glitch" data-text="Это не сигналы.">
              Это не сигналы.
            </span>
            <br />
            <span className="text-accent-cyan text-glow-cyan">Это торговый терминал.</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg text-text-secondary">
            Подключается к твоему счёту на бирже по API. Стакан, график, расчёт риска и
            заявка - в одном окне. Сигналы приходят внутрь терминала уже посчитанными под
            твой депозит.
          </p>

          {/* Три возражения, которые снимаются до первого клика. */}
          <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-text-muted">
            {[
              "Бесплатно, без подписок",
              "Деньги остаются на твоей бирже",
              "Ключи без права вывода",
            ].map((item) => (
              <li key={item} className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-accent-cyan" />
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {/* Primary CTA */}
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-accent-cyan px-7 py-3 text-[15px] font-semibold text-bg-deep transition-all duration-200 hover:bg-accent-cyan/90 active:scale-[0.97]"
            >
              Открыть терминал <ArrowRight className="h-[15px] w-[15px]" />
            </Link>

            {/* WEEX */}
            <a
              href={SOCIAL_LINKS.weexAffiliate}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-border px-7 py-3 text-[15px] font-semibold text-text-primary transition-all duration-200 hover:border-border hover:bg-bg-panel/60 active:scale-[0.97]"
            >
              Открыть счёт WEEX <ExternalLink className="h-[14px] w-[14px] opacity-50" />
            </a>

            {/* Telegram */}
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
      </div>
    </section>
  );
}
