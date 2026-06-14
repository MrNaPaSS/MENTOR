"use client";

import { useEffect, useState } from "react";
import {
  Radio,
  Activity,
  Users,
  Target,
  Trophy,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Counter from "@/components/ui/Counter";
import Reveal from "@/components/ui/Reveal";
import { api, PublicStats } from "@/lib/api";

interface StatCard {
  label: string;
  value: number | null;
  suffix?: string;
  decimals?: number;
  icon: LucideIcon;
  accent: "cyan" | "gold";
}

export default function PlatformStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .publicStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoaded(true));
  }, []);

  const cards: StatCard[] = [
    { label: "Всего сигналов", value: stats?.total_signals ?? null, icon: Radio, accent: "cyan" },
    { label: "Активных сигналов", value: stats?.active_signals ?? null, icon: Activity, accent: "cyan" },
    { label: "Активных учеников", value: stats?.active_students ?? null, icon: Users, accent: "cyan" },
    {
      label: "Винрейт",
      value: stats?.winrate != null ? Number(stats.winrate) : null,
      suffix: "%",
      decimals: 1,
      icon: Target,
      accent: "gold",
    },
    { label: "Лучший сигнал RR", value: null, suffix: "", icon: Trophy, accent: "gold" },
    { label: "На рынке (лет)", value: loaded ? new Date().getFullYear() - 2023 : null, icon: CalendarClock, accent: "cyan" },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow="Статистика платформы"
        title="Цифры, а не обещания"
        subtitle="Данные подтягиваются напрямую из ядра платформы и обновляются в реальном времени."
      />

      <div className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          const color = c.accent === "gold" ? "text-accent-gold" : "text-accent-cyan";
          const ring = c.accent === "gold" ? "ring-accent-gold/20" : "ring-accent-cyan/20";
          return (
            <Reveal key={c.label} delay={i * 0.08}>
              <div
                className={`group relative h-full overflow-hidden rounded-2xl border border-border bg-bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan/40`}
              >
                <div className="pointer-events-none absolute inset-0 bg-radial-cyan opacity-0 transition group-hover:opacity-100" />
                <div className="relative flex items-center justify-between">
                  <span className={`grid h-10 w-10 place-items-center rounded-xl bg-white/[0.03] ring-1 ${ring} ${color}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <div className={`relative mt-4 font-mono text-3xl font-bold tabular ${color}`}>
                  {!loaded ? (
                    <span className="skeleton inline-block h-8 w-20 align-middle" />
                  ) : c.value == null ? (
                    <span className="text-text-muted">—</span>
                  ) : (
                    <Counter value={c.value} suffix={c.suffix} decimals={c.decimals ?? 0} />
                  )}
                </div>
                <div className="relative mt-1 text-sm text-text-secondary">{c.label}</div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
