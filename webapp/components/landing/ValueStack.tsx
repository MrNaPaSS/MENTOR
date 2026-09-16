"use client";

// Экосистема стопкой: что ещё входит в рабочее место.
//
// Каждая карточка начинается с возражения, а не с названия функции. Список
// возможностей без возражений читается как ярмарка и вызывает не интерес, а
// вопрос «в чём тогда подвох» - на который отвечает следующий раздел страницы.
//
// Возражение набрано кавычками и курсивом и отбито линией слева: это прямая
// речь человека, а не наша формулировка, и выглядеть она должна чужой.

import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Coins,
  IdCard,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import GlowCard, { CardIcon, CARD_ACCENTS, type CardAccent } from "@/components/ui/GlowCard";
import { useT } from "@/lib/i18n";

const ICONS: LucideIcon[] = [
  BarChart3,
  BookOpen,
  CalendarDays,
  Coins,
  MessagesSquare,
  IdCard,
];

const ACCENTS: CardAccent[] = ["cyan", "violet", "green", "gold", "cyan", "violet"];

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
          const tone = CARD_ACCENTS[accent];
          return (
            <Reveal as="article" key={item.title} delay={i * 0.08}>
              <GlowCard accent={accent}>
                <CardIcon accent={accent}>
                  <Icon className="h-6 w-6" />
                </CardIcon>

                <h3 className="mt-5 text-lg font-bold text-text-primary">{item.title}</h3>

                <p className={`mt-3 border-l-2 pl-3 text-sm italic leading-relaxed text-text-muted ${tone.quote}`}>
                  {item.objection}
                </p>

                <p className="mt-3 flex-1 text-sm leading-relaxed text-text-secondary">{item.text}</p>
              </GlowCard>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
