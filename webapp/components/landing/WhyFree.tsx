"use client";

// Цена: почему рабочее место ничего не стоит.
//
// Чем длиннее список выше, тем громче вопрос «в чём подвох». Поэтому ответ
// стоит сразу за перечислением, а не в FAQ внизу страницы, и звучит он не
// оправданием, а описанием сделки: биржа платит нам, часть мы отдаём тебе.
//
// Последняя строка - главная на всей странице: она объясняет разом и
// бесплатность, и почему мы так носимся с риском. Поэтому набрана крупно и
// стоит отдельно от списка.

import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";
import { cashbackList } from "@/lib/venues";

export default function WhyFree() {
  const t = useT();
  const copy = t.landing.free;

  return (
    <section id="price" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-border bg-bg-panel/95 p-8 backdrop-blur-2xl md:p-12">
          {/* Подсветка одна на блок: раздел про деньги, и он должен читаться
              спокойно, а не мигать как баннер. */}
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent-cyan/10 blur-3xl" />

          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
            <div>
              <span className="eyebrow">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan shadow-glow-cyan" />
                {copy.eyebrow}
              </span>

              <h2 className="mt-4 text-h2 text-text-primary">{copy.title}</h2>
              <p className="mt-5 leading-relaxed text-text-secondary">{copy.text}</p>

              <p className="mt-6 text-lg font-semibold text-text-primary">{copy.kicker}</p>
            </div>

            <div>
              <ul className="space-y-3">
                {copy.points.map((point) => (
                  <li key={point} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-cyan" />
                    {point}
                  </li>
                ))}
              </ul>

              {/* Доли возврата приходят из реестра бирж - того же, что
                  сверяется с сервером. Написанные руками, они разошлись бы с
                  кабинетом на первой же правке. */}
              <p className="mt-5 rounded-2xl border border-border bg-bg-deep/40 px-5 py-4 font-mono text-sm text-accent-cyan">
                {cashbackList()}
              </p>

              <Link
                href="/broker"
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-[15px] font-semibold text-text-primary transition-all duration-200 hover:bg-bg-panel/60 active:scale-[0.97]"
              >
                <Wallet className="h-4 w-4" />
                {copy.cta}
                <ArrowRight className="h-[15px] w-[15px]" />
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
