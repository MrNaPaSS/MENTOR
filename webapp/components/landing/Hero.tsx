"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Send } from "lucide-react";
import Counter from "@/components/ui/Counter";
import HeroChart from "./HeroChart";
import { api, PublicStats } from "@/lib/api";
import { SOCIAL_LINKS } from "@/lib/content";

export default function Hero() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    api.publicStats().then(setStats).catch(() => setStats(null));
  }, []);

  const counters = [
    { value: stats?.total_signals ?? 0, label: "Сигналов отправлено", suffix: "" },
    { value: stats?.active_students ?? 0, label: "Активных учеников", suffix: "" },
    {
      value: stats?.winrate != null ? Number(stats.winrate) : 0,
      label: "Винрейт",
      suffix: "%",
      decimals: 1,
      hidden: stats?.winrate == null,
    },
  ];

  return (
    <section
      id="about"
      className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24"
    >
      {/* Лёгкие фоновые слои поверх объёмной WebGL-сцены (она рендерится за контентом) */}
      <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-30 [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 md:px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="max-w-3xl">
          <span className="badge-cyan animate-pulse-glow mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Работаем с 2023 · No Money No Honey
          </span>

          <h1 className="text-h1 text-white">
            <span
              className="glitch"
              data-text="Торгуй как профи."
            >
              Торгуй как профи.
            </span>
            <br />
            <span className="text-accent-cyan text-glow-cyan">Учись у лучших.</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg text-text-secondary">
            Персональные сигналы под твой депозит. Реальный расчёт. Реальный результат.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn-primary text-base">
              ⚡ Начать обучение <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={SOCIAL_LINKS.weexAffiliate}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline text-base"
            >
              📊 Открыть счёт на WEEX
            </a>
            <a
              href={SOCIAL_LINKS.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost text-base"
            >
              <Send className="h-4 w-4" /> Telegram
            </a>
          </div>

          {/* Лайв-счётчики */}
          <div className="mt-12 flex flex-wrap gap-3">
            {counters
              .filter((c) => !c.hidden)
              .map((c) => (
                <div
                  key={c.label}
                  className="rounded-2xl border border-border bg-bg-card/60 px-5 py-4 backdrop-blur-sm"
                >
                  <div className="font-mono text-3xl font-bold text-accent-cyan tabular">
                    <Counter value={c.value} suffix={c.suffix} decimals={c.decimals ?? 0} />
                  </div>
                  <div className="mt-1 text-xs text-text-muted">{c.label}</div>
                </div>
              ))}
          </div>
        </div>

        {/* Живой свечной график */}
        <div className="relative">
          <HeroChart />
        </div>
      </div>
    </section>
  );
}
