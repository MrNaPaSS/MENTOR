"use client";

// Витрина продукта: качество, удобство и простота одной сводкой.
//
// Плита намеренно тёмная в обеих темах и намеренно не похожа на остальные
// разделы. На светлой странице чёрное с золотом читается как вставка из
// другого, более дорогого материала - тот же приём, что на бланке сертификата
// и на карточках сделок, то есть наш собственный, а не заимствованный.
//
// Никаких иконок и подсветок: крупное значение, тонкая золотая черта и строка
// под ней. Дорого выглядит не количество украшений, а воздух между ними,
// поэтому в ячейках много пустого места, а всё движение - в одной черте,
// которая растёт при наведении.
//
// Цвета заданы числами, а не токенами темы: плита остаётся чёрной и когда
// сайт переключают на светлую тему, иначе вставка теряет весь смысл.

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
        <div
          className="relative mt-14 overflow-hidden rounded-[28px] border border-amber-400/20 bg-[#0B0B12] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]"
        >
          {/* Два блика - тёплый сверху слева и холодный снизу справа. Плоская
              заливка на такой площади выглядит как лист бумаги, а не как плита. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 80% at 8% 0%, rgba(245,200,120,0.10) 0%, transparent 60%), radial-gradient(50% 70% at 100% 100%, rgba(120,180,255,0.07) 0%, transparent 60%)",
            }}
          />

          <div className="relative grid sm:grid-cols-2 lg:grid-cols-3">
            {copy.items.map((item, i) => (
              <div
                key={item.value}
                className={`group relative px-8 py-12 transition-colors duration-500 hover:bg-white/[0.03] md:px-10 md:py-14 ${
                  i > 0 ? "border-t border-white/[0.07] sm:border-t-0" : ""
                } ${i % 2 === 1 ? "sm:border-l sm:border-white/[0.07]" : ""} ${
                  i >= 2 ? "sm:border-t sm:border-white/[0.07]" : ""
                } ${i % 3 !== 0 ? "lg:border-l lg:border-white/[0.07]" : "lg:border-l-0"} ${
                  i >= 3 ? "lg:border-t lg:border-white/[0.07]" : "lg:border-t-0"
                }`}
              >
                <div className="font-mono text-4xl font-black tracking-tight text-white md:text-[2.75rem] md:leading-none">
                  {item.value}
                </div>

                <div className="mt-5 h-px w-10 bg-amber-400/70 transition-all duration-500 group-hover:w-24" />

                <p className="mt-5 text-sm leading-relaxed text-white/55">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
