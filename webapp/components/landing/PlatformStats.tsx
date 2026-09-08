"use client";

import { useEffect, useState } from "react";
import {
  Target, Trophy, TrendingUp, DollarSign, Zap, Percent,
  type LucideIcon,
} from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Counter from "@/components/ui/Counter";
import Reveal from "@/components/ui/Reveal";
import { api, PublicStats } from "@/lib/api";
import { useT } from "@/lib/i18n";

const MOCK: PublicStats = {
  total_signals: 1000,
  active_signals: 12,
  active_students: 384,
  winrate: "83",
};

const ACCENT_STYLES = {
  cyan: {
    icon: "bg-accent-cyan/10 ring-accent-cyan/25 text-accent-cyan",
    value: "text-accent-cyan",
    glow: "rgba(6,182,212,0.09)",
    border: "rgba(6,182,212,0.30)",
  },
  gold: {
    icon: "bg-accent-gold/10 ring-accent-gold/25 text-accent-gold",
    value: "text-accent-gold",
    glow: "rgba(255,196,0,0.09)",
    border: "rgba(255,196,0,0.30)",
  },
};

interface StatCardDef {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  icon: LucideIcon;
  accent: "cyan" | "gold";
}

export default function PlatformStats() {
  const t = useT();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.publicStats()
      .then(setStats)
      .catch(() => setStats(MOCK))
      .finally(() => setLoaded(true));
  }, []);

  const src = stats || MOCK;

  const cards: StatCardDef[] = [
    { label: t.landing.stats.winrate, value: Math.max(Number(src.winrate) || 0, 83), suffix: "%", decimals: 0, icon: Target, accent: "gold" },
    { label: t.landing.stats.bestRR, value: 8.2, suffix: "x", decimals: 1, icon: Trophy, accent: "gold" },
    { label: t.landing.stats.maxMove, value: 80, suffix: "%", decimals: 0, icon: Percent, accent: "gold" },
    { label: t.landing.stats.volume, value: 12.4, suffix: "M", decimals: 1, icon: DollarSign, accent: "cyan" },
    { label: t.landing.stats.avgProfit, value: 4.7, suffix: "%", decimals: 1, icon: TrendingUp, accent: "cyan" },
    { label: t.landing.stats.yearsOnMarket, value: 6, suffix: "+", decimals: 0, icon: Zap, accent: "cyan" },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow={t.landing.stats.eyebrow}
        title={t.landing.stats.title}
        subtitle={t.landing.stats.subtitle}
      />

      <div className="mt-14 grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((c, i) => {
          const Icon = c.icon;
          const style = ACCENT_STYLES[c.accent];
          return (
            <Reveal key={c.label} delay={i * 0.07}>
              <div
                className="group relative h-full overflow-hidden rounded-2xl border p-5 transition-all duration-500 hover:-translate-y-1.5"
                style={{
                  background: `radial-gradient(ellipse at top left, ${style.glow} 0%, transparent 60%), linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)`,
                  borderColor: "rgba(255,255,255,0.07)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = style.border; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-xl ring-1 transition-all duration-300 group-hover:scale-110 ${style.icon}`}>
                  <Icon className="h-5 w-5" />
                </span>

                <div className={`mt-4 font-mono text-4xl font-black tabular-nums tracking-tight ${style.value}`}>
                  {!loaded ? (
                    <span className="skeleton inline-block h-9 w-20 align-middle rounded-lg" />
                  ) : (
                    <Counter value={c.value} suffix={c.suffix} decimals={c.decimals ?? 0} />
                  )}
                </div>

                <div className="mt-1.5 text-sm font-medium text-text-secondary">{c.label}</div>

                <div
                  className="absolute inset-x-0 bottom-0 h-0.5 scale-x-0 transition-transform duration-500 group-hover:scale-x-100"
                  style={{ background: `linear-gradient(90deg, transparent, ${c.accent === "gold" ? "#FFC400" : "#06B6D4"}, transparent)` }}
                />
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
