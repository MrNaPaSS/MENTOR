"use client";

// Главное недоразумение про академию: «ещё один канал с сигналами».
//
// Разница объясняется не прилагательными, а тем, что человек получает: свой
// счёт на бирже, подключённый по ключам, и рабочее место, где сделка живёт от
// расчёта до записи в журнале. Поэтому секция построена как сравнение - слева
// то, что человек уже видел, справа то, чего у него не было.

import {
  AlignJustify,
  BookText,
  Check,
  KeyRound,
  LineChart,
  Lock,
  MousePointerClick,
  Radar,
  Scale,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { weexRegisterUrl } from "@/lib/content";
import { useLocale, useT } from "@/lib/i18n";

interface Feature {
  icon: LucideIcon;
  accent: "cyan" | "gold" | "violet" | "green";
}

/** Возможности терминала: картинка и цвет. Заголовки и текст - в словаре. */
const FEATURES: Feature[] = [
  { icon: KeyRound, accent: "cyan" },
  { icon: AlignJustify, accent: "violet" },
  { icon: MousePointerClick, accent: "gold" },
  { icon: Scale, accent: "green" },
  { icon: Radar, accent: "cyan" },
  { icon: BookText, accent: "gold" },
];

const ACCENTS: Record<Feature["accent"], { ring: string; text: string; glow: string }> = {
  cyan: { ring: "bg-cyan-500/10 ring-cyan-500/30", text: "text-cyan-400", glow: "rgba(6,182,212,0.10)" },
  gold: { ring: "bg-amber-500/10 ring-amber-500/30", text: "text-amber-400", glow: "rgba(245,158,11,0.10)" },
  violet: { ring: "bg-purple-500/10 ring-purple-500/30", text: "text-purple-400", glow: "rgba(168,85,247,0.10)" },
  green: { ring: "bg-emerald-500/10 ring-emerald-500/30", text: "text-emerald-400", glow: "rgba(16,185,129,0.10)" },
};

/** Три вопроса про безопасность, которые задают до того, как введут ключ. */
const SAFETY_ICONS = [Lock, ShieldCheck, X];

export default function Terminal() {
  const t = useT();
  const locale = useLocale();
  const copy = t.landing.terminal;

  return (
    <section id="terminal" className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <div className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 h-72 bg-radial-cyan opacity-40" />

      <SectionHeading
        eyebrow={copy.eyebrow}
        title={
          <>
            {copy.titleTop}{" "}
            <span className="text-accent-cyan text-glow-cyan">{copy.titleAccent}</span>
          </>
        }
        subtitle={copy.subtitle}
      />

      {/* Сравнение: канал против терминала */}
      <div className="mt-14 grid gap-4 md:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-text-muted ring-1 ring-white/10">
                <X className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                  {copy.channelEyebrow}
                </div>
                <div className="font-bold text-text-secondary">{copy.channelTitle}</div>
              </div>
            </div>
            <ul className="mt-5 space-y-3">
              {copy.channelLimits.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-text-muted">
                  <X className="mt-0.5 h-4 w-4 shrink-0 opacity-50" />
                  <span className="line-through decoration-white/15">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <div
            className="relative h-full overflow-hidden rounded-2xl border p-6"
            style={{
              borderColor: "rgba(6,182,212,0.28)",
              background:
                "radial-gradient(ellipse at top right, rgba(6,182,212,0.10) 0%, transparent 60%), linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
            }}
          >
            <span className="badge-cyan absolute right-5 top-5">
              <Sparkles className="h-3 w-3" /> {copy.usBadge}
            </span>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/30">
                <LineChart className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent-cyan">
                  {copy.usEyebrow}
                </div>
                <div className="font-bold text-text-primary">{copy.usTitle}</div>
              </div>
            </div>
            <ul className="mt-5 space-y-3">
              {copy.usGains.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-text-primary">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      {/* Возможности терминала */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => {
          const a = ACCENTS[f.accent];
          const Icon = f.icon;
          const text = copy.features[i];
          return (
            <Reveal as="article" key={text.title} delay={(i % 3) * 0.1}>
              <div
                className="group h-full rounded-2xl border border-white/[0.07] p-5 transition-all duration-500 hover:-translate-y-1.5 hover:border-white/15"
                style={{
                  background: `radial-gradient(ellipse at top left, ${a.glow} 0%, transparent 60%), linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)`,
                }}
              >
                <span
                  className={`grid h-11 w-11 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110 ${a.ring} ${a.text}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-bold text-text-primary">{text.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{text.text}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/* Безопасность: три возражения, которые снимаются до ввода ключа */}
      <Reveal delay={0.1}>
        <div className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.06] sm:grid-cols-3">
          {copy.safety.map((s, i) => {
            const Icon = SAFETY_ICONS[i];
            return (
              <div key={s.title} className="bg-bg-deep/80 p-5">
                <div className="flex items-center gap-2 text-accent-cyan">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-bold text-text-primary">{s.title}</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-text-muted">{s.text}</p>
              </div>
            );
          })}
        </div>
      </Reveal>

      {/* CTA */}
      <Reveal delay={0.2}>
        <div
          className="mt-4 flex flex-col items-center gap-5 rounded-2xl border p-7 text-center md:flex-row md:justify-between md:text-left"
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(168,85,247,0.06) 100%)",
            borderColor: "rgba(6,182,212,0.22)",
          }}
        >
          <div>
            <p className="text-xl font-black text-text-primary">{copy.ctaTitle}</p>
            <p className="mt-1.5 text-sm text-text-secondary">
              {copy.ctaText}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-3">
            <Link href="/login" className="btn-primary">
              {copy.ctaPrimary}
            </Link>
            <a
              href={weexRegisterUrl(locale)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline"
            >
              {copy.ctaSecondary}
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
