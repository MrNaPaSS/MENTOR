"use client";

// Почему NMNH: четыре части одной системы.
//
// Блок выше показывает, что умеет терминал, и спорит с каналом сигналов. Этот
// отвечает на другой вопрос - «что я получаю целиком»: терминал, счета на
// пяти биржах, возврат комиссии и академию рядом. По отдельности это продают
// порознь и дорого; смысл в том, что они работают вместе.
//
// Поэтому здесь не список возможностей, а четыре части: каждая - своя, и ни
// одна не повторяет карточки терминала.

import { Building2, GraduationCap, MonitorPlay, Wallet, type LucideIcon } from "lucide-react";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

/** Части системы: картинка и цвет. Заголовки и текст - в словаре. */
const PARTS: { icon: LucideIcon; accent: "cyan" | "gold" | "violet" | "green" }[] = [
  { icon: MonitorPlay, accent: "violet" },
  { icon: Building2, accent: "cyan" },
  { icon: Wallet, accent: "gold" },
  { icon: GraduationCap, accent: "green" },
];

// Те же цвета, что у карточек терминала: блоки соседние, и разная палитра
// читалась бы как разные страницы.
const ACCENTS: Record<string, { ring: string; text: string; glow: string }> = {
  cyan: { ring: "bg-cyan-500/10 ring-cyan-500/30", text: "text-cyan-400", glow: "rgba(6,182,212,0.10)" },
  gold: { ring: "bg-amber-500/10 ring-amber-500/30", text: "text-amber-400", glow: "rgba(245,158,11,0.10)" },
  violet: { ring: "bg-purple-500/10 ring-purple-500/30", text: "text-purple-400", glow: "rgba(168,85,247,0.10)" },
  green: { ring: "bg-emerald-500/10 ring-emerald-500/30", text: "text-emerald-400", glow: "rgba(16,185,129,0.10)" },
};

export default function WhyUs() {
  const t = useT();
  const copy = t.landing.why;

  return (
    <section id="why" className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PARTS.map((part, i) => {
          const a = ACCENTS[part.accent];
          const Icon = part.icon;
          const text = copy.items[i];
          return (
            <Reveal as="article" key={text.title} delay={(i % 4) * 0.1}>
              {/* Подложка почти сплошная: сцена за страницей живая, и сквозь
                  полупрозрачную карточку тёмные свечи проходили прямо по
                  строкам текста - читать приходилось сквозь них.
                  Цветное свечение лежит отдельным слоем поверх неё - иначе
                  градиент в `style` затирал бы фон целиком. */}
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

      <Reveal delay={0.3}>
        <p className="mt-6 text-center text-sm text-text-muted">{copy.note}</p>
      </Reveal>
    </section>
  );
}
