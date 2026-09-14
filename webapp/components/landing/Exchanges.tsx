"use client";

import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import VenueMark from "@/components/ui/VenueMark";
import { EXCHANGE_SIGNUP } from "@/lib/content";
import { cashbackPct, PENDING, TRADING } from "@/lib/venues";
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
 * биржи её же цветом (`components/ui/VenueMark.tsx`). Появится `webp` -
 * подхватится сам, без правки кода.
 *
 * Под знаком - доля возврата комиссии, и это главное, что человек здесь
 * читает: знак отвечает «моя ли это биржа», процент - «зачем мне заводить
 * счёт именно так». Где возврата нет, стоит причина, а не пустота: Binance
 * запрещает партнёрам делиться комиссией, у MEXC долю ещё не назвали.
 *
 * Список и цифры - из общего реестра (`lib/venues.ts`), который сверяется с
 * сервером тестом. Подпись «в ожидании» считается от того же списка: «2 в
 * ожидании» под пятью подключёнными читалось бы как ошибка терминала.
 */

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
        {TRADING.map((venue, i) => {
          const { code, name } = venue;
          const link = signup(code);
          const back = cashbackPct(venue.cashback);
          return (
            <Reveal key={code} delay={i * 0.1}>
              <a
                href={link?.url(locale)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col items-center gap-4 rounded-2xl border border-border bg-bg-panel/60 p-6 text-center backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-accent-cyan/40"
              >
                <VenueMark
                  code={code}
                  name={name}
                  className="h-12 w-auto max-w-[140px]"
                  nameClassName="text-2xl"
                />
                <div>
                  <p className="font-bold text-text-primary">{name}</p>
                  {/* Возврат - крупно и цветом, причина его отсутствия -
                      мелко и приглушённо. Разный вес не для красоты: одно
                      здесь предложение, другое оговорка, и выглядеть
                      одинаково они не должны. */}
                  {back ? (
                    <p className="mt-1 text-[13px] font-semibold text-accent-cyan">
                      {copy.cashback(back)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] text-text-muted">
                      {venue.cashback === 0 ? copy.noCashback : copy.cashbackSoon}
                    </p>
                  )}
                  <p className="mt-0.5 text-[13px] text-text-muted">{copy.live}</p>
                  {/* Зовём открыть счёт только там, куда есть куда вести.
                      У Binance партнёрской ссылки нет - биржа не засчитывает
                      пришедших с чужим кодом, - и надпись без ссылки была бы
                      кнопкой в никуда. */}
                  {link && (
                    <p className="mt-2 text-[13px] font-semibold text-accent-cyan opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      {copy.signup}
                    </p>
                  )}
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
