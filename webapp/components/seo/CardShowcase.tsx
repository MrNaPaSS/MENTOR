// Витрина карточек сделок на странице под поисковый запрос.
//
// Пары, а не два ряда: сверху карточка, которую рисует терминал, прямо под
// ней та же сделка, как её отдаёт биржа. Числа одни и те же, разное - чей
// логотип в шапке и чей реферальный код в подвале.
//
// Сеткой, а не бегущей лентой: страница серверная, и всё, ради чего её нашли,
// должно быть в исходном HTML, а не приезжать скриптом.

import { TRADING } from "@/lib/venues";
import { SHOWCASE_TOTALS, SHOWCASE_TRADES } from "@/lib/showcase";
import type { SeoShowcase } from "@/lib/seo/pages/types";

/** Число с разделителем тысяч и знаком: доход без плюса читается как остаток. */
function signed(value: number, digits = 0): string {
  const body = value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return value >= 0 ? `+${body}` : body;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-panel/60 px-5 py-4">
      <div className="font-mono text-2xl font-extrabold tabular-nums text-accent-cyan">{value}</div>
      <div className="mt-1 text-sm text-text-secondary">{label}</div>
    </div>
  );
}

export default function CardShowcase({ copy }: { copy: SeoShowcase }) {
  return (
    <section className="mt-16">
      <h2 className="text-h3 text-text-primary">{copy.heading}</h2>
      <p className="mt-4 leading-relaxed text-text-secondary">{copy.intro}</p>

      {/* Числа считаются по самим сделкам витрины: строка рядом с карточками
          обязана быть суммой именно их, а не тем, что посчитали руками. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat value={`${signed(SHOWCASE_TOTALS.pnl)} USDT`} label={copy.statPnl} />
        <Stat value={`${signed(SHOWCASE_TOTALS.bestRoi, 2)}%`} label={copy.statBest} />
        <Stat value={String(TRADING.length)} label={copy.statVenues} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-text-muted">{copy.honest}</p>

      {/* Пара в строку: слева карточка терминала, справа та же сделка с
          биржи. Друг под другом они читались как две разные ленты - глаз
          сравнивает то, что стоит рядом.

          Колонкой в две карточки и не шире текста: восемь пар во всю ширину
          страницы превращали раздел в обои. На телефоне пара остаётся парой -
          ради неё раздел и существует, - только уже. */}
      <div className="mx-auto mt-8 max-w-xl space-y-6">
        {SHOWCASE_TRADES.map((trade, i) => (
          <div key={trade.file} className="grid grid-cols-2 gap-3 sm:gap-5">
            <figure className="m-0">
              {/* Подписи только у первой пары: дальше и так видно, где чьё, а
                  восемь раз повторённая надпись - шум. */}
              {i === 0 && (
                <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-cyan sm:text-[11px] sm:tracking-[0.18em]">
                  {copy.ours}
                </figcaption>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/showcase/nmnh/${trade.file}.jpg`}
                alt={`Карточка сделки ${trade.symbol} из терминала NMNH`}
                loading="lazy"
                decoding="async"
                className="w-full rounded-2xl border border-border bg-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
              />
            </figure>

            <figure className="m-0">
              {i === 0 && (
                <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted sm:text-[11px] sm:tracking-[0.18em]">
                  {copy.theirs}
                </figcaption>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/showcase/weex/${trade.file}.jpg`}
                alt={`Та же сделка ${trade.symbol} карточкой биржи`}
                loading="lazy"
                decoding="async"
                // Биржевая приглушена: она здесь довод, а не вторая витрина.
                className="w-full rounded-2xl border border-border opacity-60 saturate-[0.75]"
              />
            </figure>
          </div>
        ))}
      </div>
    </section>
  );
}
