"use client";

// Сертификат трейдера: бланк и четыре условия.
//
// Продают его не слова про «подтверждение уровня», а сами условия. На рынке,
// где сертификат означает «досидел до конца вебинара», у нас он означает
// пятьдесят сделок, подтверждённых биржей, двадцать дней со стопом и месяц в
// плюсе. Человек читает эти четыре строки и понимает, что за ними стоит
// настоящая работа - а раз работа настоящая, то и бумага чего-то стоит.
//
// Показываем чистый бланк, а не чужой выданный сертификат: имя и номер на
// картинке лендинга - это всегда чьи-то личные данные, и ради красоты их
// показывать нельзя.

/* eslint-disable @next/next/no-img-element */

import { Award, Dumbbell, GraduationCap, TrendingUp, type LucideIcon } from "lucide-react";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

const ICONS: LucideIcon[] = [GraduationCap, Dumbbell, Award, TrendingUp];

export default function Certificate() {
  const t = useT();
  const copy = t.landing.cert;

  return (
    <section id="certificate" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      {/* Условия слева, бланк справа: соседний раздел ставит карточку слева, и
          два вертикальных снимка подряд у одного края читались бы как колонка
          картинок, а не как два разных разговора. */}
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
        {/* Текст в панели, а не прямо на странице: за страницей живая сцена со
            свечами, и длинный абзац поверх неё читается с трудом - особенно на
            телефоне, где колонка во всю ширину. */}
        <Reveal delay={0.1} className="rounded-3xl border border-border bg-bg-panel/95 p-6 backdrop-blur-2xl md:p-8">
          <span className="eyebrow">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
            {copy.eyebrow}
          </span>

          <h2 className="mt-4 text-h2 text-text-primary">{copy.title}</h2>
          <p className="mt-4 text-text-secondary">{copy.subtitle}</p>

          {/* Столпы списком, а не карточками: это условия выдачи, и читать их
              надо подряд сверху вниз, как требования. */}
          <ul className="mt-8 space-y-4">
            {copy.pillars.map((pillar, i) => {
              const Icon = ICONS[i % ICONS.length];
              return (
                <li key={pillar.title} className="flex gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/25">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-semibold text-text-primary">{pillar.title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-text-secondary">{pillar.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-8 border-l-2 border-amber-500/40 pl-4 text-sm leading-relaxed text-text-muted">
            {copy.note}
          </p>
        </Reveal>

        <Reveal>
          <img
            src="/certificates/blank-gold.jpg"
            alt={copy.alt}
            loading="lazy"
            decoding="async"
            className="w-full rounded-2xl border border-amber-500/20 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
          />
        </Reveal>
      </div>
    </section>
  );
}
