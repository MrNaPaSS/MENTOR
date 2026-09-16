"use client";

// Почему сливают: три причины, названные словами самого трейдера.
//
// Блок стоит до рассказа о продукте намеренно. Пока человек не узнал в
// описании себя, любое перечисление возможностей читается как реклама - а
// после того как узнал, оно читается как ответ. Ни одна из причин не про вход
// в рынок: все три про исполнение, и все три закрывает терминал.
//
// Нумерация крупная и приглушённая: три карточки в ряд без счёта читаются как
// равнозначные пункты, а здесь важен порядок - от самой частой ошибки к самой
// дорогой.

import { Calculator, Receipt, Flame, type LucideIcon } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import GlowCard, { CardIcon } from "@/components/ui/GlowCard";
import { useT } from "@/lib/i18n";

const ICONS: LucideIcon[] = [Calculator, Receipt, Flame];

export default function Problem() {
  const t = useT();
  const copy = t.landing.problem;

  return (
    <section id="problem" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {copy.items.map((item, i) => {
          const Icon = ICONS[i % ICONS.length];
          return (
            <Reveal as="article" key={item.title} delay={i * 0.1}>
              <GlowCard accent="rose">
                {/* Номер акцентным цветом и почти прозрачный: белым он был
                    виден только на тёмной теме, а на светлой пропадал вовсе. */}
                <span
                  aria-hidden
                  className="absolute right-4 top-2 select-none font-mono text-6xl font-black leading-none text-rose-400 opacity-[0.16] transition-opacity duration-500 group-hover:opacity-30"
                >
                  {`0${i + 1}`}
                </span>

                <CardIcon accent="rose">
                  <Icon className="h-6 w-6" />
                </CardIcon>

                <h3 className="mt-5 text-lg font-bold text-text-primary">{item.title}</h3>
                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-text-secondary">{item.text}</p>

                <div className="mt-5 h-0.5 w-8 rounded-full bg-rose-400/50 transition-all duration-500 group-hover:w-full group-hover:bg-rose-400/70" />
              </GlowCard>
            </Reveal>
          );
        })}
      </div>

      {/* Переход к продукту: одна строка, которая превращает список бед в
          обещание. Без неё раздел заканчивается на грустной ноте и человек
          уходит думать, а не читать дальше. */}
      <Reveal delay={0.3}>
        <p className="mt-10 text-center text-lg font-semibold text-text-primary">{copy.note}</p>
      </Reveal>
    </section>
  );
}
