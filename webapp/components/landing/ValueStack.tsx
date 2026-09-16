"use client";

// Экосистема стопкой: что ещё входит в рабочее место.
//
// Каждая карточка начинается с возражения, а не с названия функции. Список
// возможностей без возражений читается как ярмарка и вызывает не интерес, а
// вопрос «в чём тогда подвох» - на который отвечает следующий раздел страницы.
//
// Возражение набрано кавычками и курсивом: это прямая речь человека, а не наша
// формулировка, и выглядеть она должна чужой.

import {
  BarChart3,
  BookOpen,
  Coins,
  GraduationCap,
  IdCard,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

const ICONS: LucideIcon[] = [BarChart3, BookOpen, Coins, MessagesSquare, IdCard, GraduationCap];

const ACCENTS = [
  { ring: "bg-cyan-500/10 ring-cyan-500/30", text: "text-cyan-400" },
  { ring: "bg-purple-500/10 ring-purple-500/30", text: "text-purple-400" },
  { ring: "bg-amber-500/10 ring-amber-500/30", text: "text-amber-400" },
  { ring: "bg-emerald-500/10 ring-emerald-500/30", text: "text-emerald-400" },
  { ring: "bg-cyan-500/10 ring-cyan-500/30", text: "text-cyan-400" },
  { ring: "bg-purple-500/10 ring-purple-500/30", text: "text-purple-400" },
];

export default function ValueStack() {
  const t = useT();
  const copy = t.landing.stack;

  return (
    <section id="stack" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {copy.items.map((item, i) => {
          const Icon = ICONS[i % ICONS.length];
          const accent = ACCENTS[i % ACCENTS.length];
          return (
            <Reveal as="article" key={item.title} delay={i * 0.08}>
              <div className="group h-full rounded-2xl border border-border bg-bg-panel/95 p-6 backdrop-blur-2xl transition-all duration-500 hover:-translate-y-1">
                <span className={`grid h-12 w-12 place-items-center rounded-2xl ring-1 ${accent.ring} ${accent.text}`}>
                  <Icon className="h-6 w-6" />
                </span>

                <h3 className="mt-5 text-lg font-bold text-text-primary">{item.title}</h3>

                <p className="mt-2 text-sm italic leading-relaxed text-text-muted">{item.objection}</p>

                <p className="mt-3 text-sm leading-relaxed text-text-secondary">{item.text}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
