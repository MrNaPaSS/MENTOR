"use client";

// Видимая часть открытой страницы калькулятора.
//
// Отдельным файлом, потому что сама страница остаётся серверной: у неё есть
// `metadata` для поисковиков, а язык интерфейса живёт в браузере. Разметку,
// которая переводится, приходится отделить от той, которую читает робот.

import type { ReactNode } from "react";
import { Gauge, Zap, ShieldCheck, type LucideIcon } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import Badge from "@/components/ui/Badge";
import Calculator from "@/components/Calculator";
import { useT } from "@/lib/i18n";

const ICONS: LucideIcon[] = [Gauge, Zap, ShieldCheck];

/** children - серверный текст для поисковика, он встаёт под калькулятором. */
export default function CalculatorIntro({ children }: { children?: ReactNode }) {
  const t = useT();
  const c = t.tools.calculator;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-28 md:px-6 md:pt-32">
      <div className="flex justify-center">
        <Badge variant="cyan">{c.badge}</Badge>
      </div>
      <SectionHeading
        as="h1"
        className="mt-4"
        eyebrow={c.eyebrow}
        title={c.title}
        subtitle={c.subtitle}
      />

      <Reveal className="mt-12">
        <Calculator />
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {c.info.map(({ title, text }, i) => {
          const Icon = ICONS[i];
          return (
            <Reveal key={title} className="card">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent-cyan/10 text-accent-cyan ring-1 ring-accent-cyan/25">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-text-primary">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{text}</p>
            </Reveal>
          );
        })}
      </div>

      <p className="mt-10 text-center text-xs text-text-muted">{c.disclaimer}</p>

      {children}
    </main>
  );
}
