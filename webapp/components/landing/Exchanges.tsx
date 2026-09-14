"use client";

import { useState } from "react";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { EXCHANGE_SIGNUP } from "@/lib/content";
import { useLocale, useT } from "@/lib/i18n";

/**
 * Биржи, с которыми работает терминал.
 *
 * Вопрос «а где именно я буду торговать» человек задаёт раньше, чем читает про
 * стакан и сопровождение, - и до этого блока ответа на главной не было вовсе.
 *
 * Показываем знаки бирж, а не список названий: свою биржу человек узнаёт по
 * знаку быстрее, чем прочитает слово. Знаки те же, что в кабинете на карточке
 * счёта, - узнавание должно работать в обе стороны.
 *
 * Здесь только те, где торговля уже идёт. Писать «скоро» под чужими
 * логотипами нельзя: это выглядит как партнёрство, которого нет, - число
 * остальных названо словами в подписи.
 *
 * Знака у биржи может ещё не быть: файл кладут руками, а биржа подключается
 * кодом, и ждать картинку значит держать подключённую биржу невидимой.
 * Поэтому карточка переживает отсутствие файла - вместо знака она пишет имя
 * биржи её же цветом (`Mark` ниже). Появится `webp` - подхватится сам, без
 * правки кода.
 */
const LIVE = [
  { code: "weex", name: "WEEX", mark: "/art/brand/weex-mark.webp", glow: "art-glow", tint: "#f0b90b" },
  { code: "okx", name: "OKX", mark: "/art/brand/okx-mark.webp", glow: "mark-ink", tint: "currentColor" },
  { code: "bingx", name: "BingX", mark: "/art/brand/bingx-mark.webp", glow: "art-glow-blue", tint: "#2563eb" },
  { code: "mexc", name: "MEXC", mark: "/art/brand/mexc-mark.webp", glow: "art-glow-green", tint: "#00b897" },
  { code: "binance", name: "Binance", mark: "/art/brand/binance-mark.webp", glow: "art-glow", tint: "#f0b90b" },
] as const;

/**
 * Сколько бирж из реестра ещё ждут подключения (`core/venues.py`, `trading`).
 * Число живёт здесь, а не в словаре: меняется оно вместе со списком выше, и
 * разъехаться им нельзя - подпись «5 в ожидании» под пятью подключёнными
 * читается как ошибка терминала.
 */
const PENDING = 2;

/** Знак биржи, а если файла ещё нет - её имя тем же цветом. */
function Mark({ src, name, glow, tint }: { src: string; name: string; glow: string; tint: string }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <span
        className="flex h-12 items-center text-2xl font-black tracking-tight"
        style={{ color: tint }}
      >
        {name}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setMissing(true)}
      className={`h-12 w-auto max-w-[140px] object-contain ${glow}`}
    />
  );
}

export default function Exchanges() {
  const t = useT();
  const locale = useLocale();
  const copy = t.landing.exchanges;
  // Партнёрская ссылка биржи, если она у нас есть: карточка тогда ведёт на
  // регистрацию, а не просто показывает знак.
  const signup = (code: string) => EXCHANGE_SIGNUP.find((one) => one.code === code);

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {LIVE.map((one, i) => {
          const link = signup(one.code);
          return (
            <Reveal key={one.code} delay={i * 0.1}>
              <a
                href={link?.url(locale)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col items-center gap-4 rounded-2xl border border-border bg-bg-panel/60 p-6 text-center backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan/40"
              >
                <Mark src={one.mark} name={one.name} glow={one.glow} tint={one.tint} />
                <div>
                  <p className="font-bold text-text-primary">{one.name}</p>
                  <p className="mt-1 text-[13px] text-text-muted">{copy.live}</p>
                  <p className="mt-2 text-[13px] font-semibold text-accent-cyan opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {copy.signup}
                  </p>
                </div>
              </a>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.3}>
        <p className="mt-6 text-center text-sm text-text-muted">{copy.note(PENDING)}</p>
      </Reveal>
    </section>
  );
}
