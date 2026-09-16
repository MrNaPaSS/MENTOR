"use client";

// Витрина продукта: качество, удобство и простота одной сводкой.
//
// Сознательно сделана иначе, чем остальные разделы главной. Там карточки с
// иконками, подсветкой и цветом - здесь ничего этого нет: крупное значение,
// строка под ним и тонкая сетка линий. Дорого выглядит не количество украшений,
// а воздух между ними, поэтому единственное украшение раздела - размер цифр и
// пустое место вокруг.
//
// Сетка собрана границами ячеек, а не карточками: карточка отделяет пункт от
// страницы, линия - соединяет пункты между собой. Для сводки нужно второе.

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

export default function Showcase() {
  const t = useT();
  const copy = t.landing.showcase;

  return (
    <section id="showcase" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <Reveal delay={0.05}>
        <div className="mt-14 overflow-hidden rounded-3xl border border-border bg-bg-panel/95 shadow-2xl backdrop-blur-2xl">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3">
            {copy.items.map((item, i) => (
              <div
                key={item.value}
                // Линии только между ячейками: рамка по краю уже нарисована
                // контейнером, и вторая по тем же местам даёт двойную черту.
                className={`group relative px-7 py-10 transition-colors duration-500 hover:bg-bg-panel/80 md:px-9 md:py-12 ${
                  i % 2 === 1 ? "sm:border-l sm:border-border" : ""
                } ${i % 3 !== 0 ? "lg:border-l lg:border-border" : "lg:border-l-0"} ${
                  i >= 2 ? "sm:border-t sm:border-border" : ""
                } ${i >= 3 ? "lg:border-t lg:border-border" : "lg:border-t-0"} ${
                  i > 0 ? "border-t border-border sm:border-t-0" : ""
                }`}
              >
                <div className="font-mono text-3xl font-black tracking-tight text-text-primary md:text-4xl">
                  {item.value}
                </div>

                {/* Линия под значением - единственный акцентный цвет в разделе.
                    Она же растёт на наведении: движение вместо подсветки. */}
                <div className="mt-4 h-px w-10 bg-accent-cyan transition-all duration-500 group-hover:w-20" />

                <p className="mt-4 text-sm leading-relaxed text-text-secondary">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
