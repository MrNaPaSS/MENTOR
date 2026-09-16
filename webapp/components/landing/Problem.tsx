"use client";

// Почему сливают: три причины, названные словами самого трейдера.
//
// Блок стоит до рассказа о продукте намеренно. Пока человек не узнал в
// описании себя, любое перечисление возможностей читается как реклама - а
// после того как узнал, оно читается как ответ. Ни одна из причин не про вход
// в рынок: все три про исполнение, и все три закрывает терминал.
//
// Нумерация крупная и приглушённая, как в блоке шагов: три карточки в ряд без
// счёта читаются как равнозначные пункты, а здесь важен порядок - от самой
// частой ошибки к самой дорогой.

import { Calculator, Receipt, Flame, type LucideIcon } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
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
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-bg-panel/95 p-6 backdrop-blur-2xl transition-all duration-500 hover:-translate-y-1">
                <span
                  className="absolute right-4 top-2 select-none font-mono text-6xl font-black leading-none"
                  style={{ color: "rgba(255,255,255,0.04)", WebkitTextStroke: "1px rgba(255,255,255,0.07)" }}
                >
                  {`0${i + 1}`}
                </span>

                <span className="relative z-10 grid h-12 w-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/25">
                  <Icon className="h-6 w-6" />
                </span>

                <h3 className="relative z-10 mt-5 text-lg font-bold text-text-primary">{item.title}</h3>
                <p className="relative z-10 mt-2.5 text-sm leading-relaxed text-text-secondary">{item.text}</p>
              </div>
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
