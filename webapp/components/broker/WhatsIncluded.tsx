"use client";

import {
  BarChart3,
  KeyRound,
  MousePointer2,
  NotebookText,
  ServerCog,
  Shield,
  type LucideIcon,
} from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

/** Значки по порядку пунктов словаря. */
const ICONS: LucideIcon[] = [BarChart3, MousePointer2, Shield, ServerCog, NotebookText, KeyRound];

/**
 * Что входит в бесплатный доступ.
 *
 * Идёт сразу после разбора тарифов и отвечает на вопрос, который тот разбор
 * создаёт: «раз ступеней нет, что же тогда дают». Все шесть пунктов - про
 * работающие вещи, ни одного «скоро»: обещания живут в разделе бирж, а здесь
 * только то, чем торгуют сегодня.
 */
export default function WhatsIncluded() {
  const t = useT();

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow={t.broker.included.eyebrow}
        title={t.broker.included.title}
        subtitle={t.broker.included.subtitle}
      />

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {t.broker.included.items.map((item, i) => {
          const Icon = ICONS[i % ICONS.length];
          return (
            <Reveal as="article" key={item.title} delay={i * 0.07}>
              <div className="group h-full rounded-2xl border border-border bg-bg-card/70 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan/30">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25 transition-transform duration-300 group-hover:scale-110">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-bold text-text-primary">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{item.text}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
