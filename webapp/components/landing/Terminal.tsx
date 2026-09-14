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
import { useT } from "@/lib/i18n";
import SignupPicker from "@/components/landing/SignupPicker";

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
  const copy = t.landing.terminal;

  return (
    <section id="terminal" className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <div className="pointer-events-none absolute inset-x-0 top-1/4 -z-10 h-72 bg-radial-cyan opacity-40" />

      {/* Шапка в две колонки: слева - о чём раздел, справа - карточка
          терминала с тем, что человек получает.

          Раньше карточка стояла ниже, рядом с колонкой «Канал с сигналами», и
          весь смысл держался на споре с каналами. Спор убран: мы не сравниваем
          себя с сигналами, а показываем инструмент. */}
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <SectionHeading
          align="left"
          eyebrow={copy.eyebrow}
          title={
            <>
              {copy.titleTop}{" "}
              <span className="text-accent-cyan text-glow-cyan">{copy.titleAccent}</span>
            </>
          }
          subtitle={copy.subtitle}
        />

        <Reveal delay={0.12}>
          <div className="relative overflow-hidden rounded-2xl border border-accent-cyan/25 bg-bg-panel/95 p-6 backdrop-blur-2xl">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at top right, rgba(6,182,212,0.12) 0%, transparent 60%)",
              }}
            />
            <div className="relative">
              <span className="badge-cyan absolute right-0 top-0">
                <Sparkles className="h-3 w-3" /> {copy.usBadge}
              </span>
              {/* Подписи «как у нас» больше нет: сравнивать не с чем, раздел
                  показывает инструмент, а не спорит с каналами. */}
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/30">
                  <LineChart className="h-4 w-4" />
                </span>
                <div className="text-lg font-bold text-text-primary">{copy.usTitle}</div>
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
          </div>
        </Reveal>
      </div>

      {/* Как он выглядит. Раздел рассказывает про рабочее место трейдера, и
          показать его надо раньше, чем объяснять словами: человек решает по
          картинке, читать ли дальше. Грузится лениво - первый экран выше. */}
      <Reveal delay={0.05}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/art/seo/terminal-cover.webp"
          alt={copy.shotAlt}
          loading="lazy"
          decoding="async"
          className="mt-12 w-full rounded-2xl border border-white/[0.07] shadow-2xl"
        />
      </Reveal>

      {/* Возможности терминала */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => {
          const a = ACCENTS[f.accent];
          const Icon = f.icon;
          const text = copy.features[i];
          return (
            <Reveal as="article" key={text.title} delay={(i % 3) * 0.1}>
              {/* Подложка почти сплошная: за страницей живая сцена, и сквозь
                  полупрозрачную карточку тёмные свечи шли прямо по строкам. */}
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-bg-panel/95 p-5 backdrop-blur-2xl transition-all duration-500 hover:-translate-y-1.5 hover:border-accent-cyan/30">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `radial-gradient(ellipse at top left, ${a.glow} 0%, transparent 60%)`,
                  }}
                />
                <div className="relative">
                  <span
                    className={`grid h-11 w-11 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110 ${a.ring} ${a.text}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-bold text-text-primary">{text.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">{text.text}</p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/* Безопасность: три возражения, которые снимаются до ввода ключа */}
      <Reveal delay={0.1}>
        <div className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-border bg-border/60 backdrop-blur-2xl sm:grid-cols-3">
          {copy.safety.map((s, i) => {
            const Icon = SAFETY_ICONS[i];
            return (
              <div key={s.title} className="bg-bg-panel/95 p-5">
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
        <div className="relative mt-4 flex flex-col items-center gap-5 overflow-hidden rounded-2xl border border-accent-cyan/25 bg-bg-panel/95 p-7 text-center backdrop-blur-2xl md:flex-row md:justify-between md:text-left">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(6,182,212,0.10) 0%, rgba(168,85,247,0.07) 100%)",
            }}
          />
          <div className="relative">
            <p className="text-xl font-black text-text-primary">{copy.ctaTitle}</p>
            <p className="mt-1.5 text-sm text-text-secondary">
              {copy.ctaText}
            </p>
          </div>
          <div className="relative flex shrink-0 flex-wrap justify-center gap-3">
            <Link href="/login" className="btn-primary">
              {copy.ctaPrimary}
            </Link>
            <SignupPicker label={copy.ctaSecondary} className="btn-outline" />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
