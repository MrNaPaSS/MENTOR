"use client";

// Сделка по шагам: увидеть, войти, вести, посчитать.
//
// Раздел для того, кто уже торгует. Он продаёт не возможности, а секунды и
// клики: каждая строка - это работа, которую в интерфейсе биржи делают руками
// или в уме. Поэтому колонки названы действиями трейдера, а не разделами
// интерфейса, и внутри списки, а не абзацы: список читают глазами по
// диагонали, а абзац на такой странице пропускают целиком.
//
// Колонки соединены линией на широком экране - ту же линию использует блок
// шагов старта, и это тот случай, когда повтор приёма нужен: оба раздела про
// последовательность.

import { Eye, LogIn, Move, Calculator, type LucideIcon } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import GlowCard, { CardIcon, CARD_ACCENTS, type CardAccent } from "@/components/ui/GlowCard";
import { useT } from "@/lib/i18n";

const ICONS: LucideIcon[] = [Eye, LogIn, Move, Calculator];
const ACCENTS: CardAccent[] = ["cyan", "green", "gold", "violet"];

export default function TradeFlow() {
  const t = useT();
  const copy = t.landing.flow;

  return (
    <section id="flow" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="relative mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-14 hidden h-px lg:block"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(6,182,212,0.15) 20%, rgba(6,182,212,0.4) 50%, rgba(6,182,212,0.15) 80%, transparent)",
          }}
        />

        {copy.steps.map((step, i) => {
          const Icon = ICONS[i % ICONS.length];
          const accent = ACCENTS[i % ACCENTS.length];
          const tone = CARD_ACCENTS[accent];
          return (
            <Reveal as="article" key={step.title} delay={i * 0.1}>
              <GlowCard accent={accent}>
                <div className="flex items-center justify-between">
                  <CardIcon accent={accent}>
                    <Icon className="h-6 w-6" />
                  </CardIcon>

                  {/* Номер акцентным цветом и почти прозрачный - белым он
                      пропадал на светлой теме. */}
                  <span
                    aria-hidden
                    className={`select-none font-mono text-4xl font-black leading-none opacity-[0.18] transition-opacity duration-500 group-hover:opacity-30 ${tone.text}`}
                  >
                    {`0${i + 1}`}
                  </span>
                </div>

                <h3 className="mt-5 text-lg font-bold text-text-primary">{step.title}</h3>

                <ul className="mt-4 flex-1 space-y-3">
                  {step.items.map((line) => (
                    <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                      {/* Точка вместо галочки: галочка обещает, что всё
                          перечисленное - преимущество, а здесь просто
                          перечень того, что происходит. */}
                      <span className={`mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current ${tone.text}`} />
                      {line}
                    </li>
                  ))}
                </ul>
              </GlowCard>
            </Reveal>
          );
        })}
      </div>

      {/* Оговорка про риск стоит внутри раздела, а не в подвале: раздел
          обещает скорость и точность исполнения, и ровно здесь надо сказать,
          чего он не обещает. */}
      <Reveal delay={0.3}>
        <p className="mx-auto mt-10 max-w-3xl text-center text-sm leading-relaxed text-text-muted">{copy.note}</p>
      </Reveal>
    </section>
  );
}
