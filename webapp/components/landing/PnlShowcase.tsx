"use client";

// Витрина карточек сделки: наш бланк против бланка биржи.
//
// Одну ленту карточек человек читает как «чужая прибыль» и листает дальше.
// Две ленты друг под другом читаются иначе: сверху карточка, которую рисует
// терминал, снизу - та же сделка, как её отдаёт биржа. Пары идут строго одна
// под другой, обе ленты одной скоростью в одну сторону - иначе сравнивать
// будет нечего.
//
// Картинки статические, а не с сервера: лендинг выкладывается отдельно от
// бэкенда, и витрина не должна гаснуть вместе с ним.

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { useT } from "@/lib/i18n";

/**
 * Пары карточек: одно имя на обе. Наша лежит в `showcase/nmnh`, биржевая - в
 * `showcase/weex`, и общее имя держит их вместе: разъехавшиеся пары
 * превращают сравнение в две случайные ленты.
 */
const PAIRS = [
  "01-xrpusdt",
  "02-jupusdt",
  "03-taousdt",
  "04-jupusdt",
  "05-injusdt",
  "06-hypeusdt",
  "07-wldusdt",
  "08-injusdt",
] as const;

function Row({ dir, alt, dim }: { dir: "nmnh" | "weex"; alt: string; dim?: boolean }) {
  // Лента едет бесконечно, поэтому список идёт дважды, а проезд - ровно
  // половина ширины: на стыке кадр повторяется незаметно.
  const loop = [...PAIRS, ...PAIRS];
  return (
    <div className="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
      <div className="flex w-max animate-marquee gap-4 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {loop.map((name, i) => (
          <div
            key={`${name}-${i}`}
            className={`w-[260px] shrink-0 overflow-hidden rounded-2xl border border-border bg-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.4)] sm:w-[300px] ${
              // Биржевую карточку приглушаем: она здесь как довод, а не как
              // вторая витрина, и спорить за внимание с нашей не должна.
              dim ? "opacity-60 saturate-[0.85] transition-opacity duration-300 hover:opacity-100" : ""
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/showcase/${dir}/${name}.jpg`}
              alt={alt}
              loading="lazy"
              decoding="async"
              className="w-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Подпись ряда: без неё две ленты читаются как одна длинная. */
function RowLabel({ text, accent }: { text: string; accent?: boolean }) {
  return (
    <div
      className={`mb-3 px-4 text-xs font-bold uppercase tracking-[0.2em] md:px-6 ${
        accent ? "text-accent-cyan" : "text-text-muted"
      }`}
    >
      {text}
    </div>
  );
}

export default function PnlShowcase() {
  const t = useT();
  const copy = t.landing.results;

  return (
    <section id="results" className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

        {/* Чем ещё терминал рисует сам. Строкой, а не карточками: это уточнение
            к витрине, а не отдельный раздел со своим весом. */}
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {copy.own.map((item) => (
            <li
              key={item}
              className="rounded-full border border-border bg-bg-panel/60 px-3.5 py-1.5 text-xs font-semibold text-text-secondary"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>

      <Reveal delay={0.05}>
        <div className="mt-12">
          <RowLabel text={copy.ours} accent />
          <Row dir="nmnh" alt={copy.imageAlt} />
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-8">
          <RowLabel text={copy.theirs} />
          <Row dir="weex" alt={copy.exchangeAlt} dim />
        </div>
      </Reveal>
    </section>
  );
}
