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

      {/* Сетка шире колонки текста: карточка - картинка, и в ширину абзаца
          числа на ней приходится разглядывать. */}
      <div className="mt-8 grid w-[calc(100%+2rem)] max-w-none -translate-x-4 gap-6 sm:grid-cols-2 md:w-[calc(100%+6rem)] md:-translate-x-12 lg:w-[calc(100%+14rem)] lg:-translate-x-28">
        {SHOWCASE_TRADES.map((trade) => (
          <figure key={trade.file} className="m-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/showcase/nmnh/${trade.file}.jpg`}
              alt={`Карточка сделки ${trade.symbol} из терминала NMNH`}
              loading="lazy"
              decoding="async"
              className="w-full rounded-2xl border border-border bg-bg-deep shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
            />
            <figcaption className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              {copy.theirs}
            </figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/showcase/weex/${trade.file}.jpg`}
              alt={`Та же сделка ${trade.symbol} карточкой биржи`}
              loading="lazy"
              decoding="async"
              // Биржевая приглушена: она здесь довод, а не вторая витрина.
              className="mt-2 w-full rounded-2xl border border-border opacity-60 saturate-[0.75]"
            />
          </figure>
        ))}
      </div>
    </section>
  );
}
