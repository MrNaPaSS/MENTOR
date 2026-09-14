"use client";

import { Mail, Send } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { EXCHANGES, type Exchange, type ExchangeStatus } from "@/lib/broker/program";
import { cashbackShare } from "@/lib/broker/economics";
import { rate, share } from "@/lib/broker/format";
import { PARTNER_EMAIL, SOCIAL_LINKS } from "@/lib/content";
import { useLocale, useT } from "@/lib/i18n";

/**
 * Ячейка возврата: доля числом либо причина, по которой её нет.
 *
 * Три ответа, и путать их нельзя. Доля названа - показываем её. Ноль пришёл
 * намеренно (Binance запрещает партнёрам делиться комиссией) - пишем «биржа
 * не разрешает», а не прочерк: прочерк читается как «забыли». Пусто - долю
 * ещё не назвали, и это «пока не знаем», а не «не будет».
 */
function Cashback({ exchange }: { exchange: Exchange }) {
  const t = useT();
  const locale = useLocale();
  const copy = t.broker.exchanges;
  const back = cashbackShare(exchange);

  if (back > 0) {
    return (
      <span className="font-mono font-bold tabular-nums text-accent-cyan">
        {share(back, locale)}
      </span>
    );
  }
  return (
    <span className="text-sm text-text-muted">
      {exchange.cashback === 0 ? copy.cashbackNo : copy.cashbackSoon}
    </span>
  );
}

/** Цвет метки статуса. Работающая биржа зелёная, остальные приглушены. */
const STATUS_STYLE: Record<ExchangeStatus, string> = {
  live: "bg-success/10 text-success ring-success/25",
  soon: "bg-bg-panel text-text-muted ring-border",
};

/**
 * Список бирж - самое проверяемое место страницы.
 *
 * Каждый, кто дочитал до сюда, первым делом ищет свою биржу, и от того, что
 * он в этой строке увидит, зависит доверие ко всему остальному. Поэтому
 * статус пишется словами, а не значком, и «скоро» здесь означает «пока
 * нельзя», а не «почти готово».
 */
export default function ExchangeTable() {
  const t = useT();
  const locale = useLocale();
  const copy = t.broker.exchanges;

  return (
    <section id="exchanges" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <Reveal className="mt-14">
        <div className="overflow-x-auto rounded-2xl border border-border bg-bg-panel/85 backdrop-blur-xl p-5 md:p-6">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-text-muted">
                <th className="pb-3 font-semibold">{copy.columns.exchange}</th>
                <th className="pb-3 font-semibold">{copy.columns.maker}</th>
                <th className="pb-3 font-semibold">{copy.columns.taker}</th>
                {/* Возврат - отдельной колонкой, а не спрятан в расчёт
                    «после возврата». Ради него человек и читает таблицу, и
                    там, где его нет, он обязан увидеть это словом, а не
                    вывести из двух одинаковых чисел. */}
                <th className="pb-3 font-semibold">{copy.columns.cashback}</th>
                <th className="pb-3 font-semibold">{copy.columns.effective}</th>
                <th className="pb-3 text-right font-semibold">{copy.columns.status}</th>
              </tr>
            </thead>
            <tbody>
              {EXCHANGES.map((exchange) => {
                const live = exchange.status === "live";
                const back = cashbackShare(exchange);
                return (
                  <tr key={exchange.id} className="border-t border-border">
                    <td className="py-3.5 font-semibold text-text-primary">{exchange.name}</td>
                    <td className="py-3.5 font-mono tabular-nums text-text-secondary">
                      {rate(exchange.makerRate, locale)}
                    </td>
                    <td className="py-3.5 font-mono tabular-nums text-text-secondary">
                      {rate(exchange.takerRate, locale)}
                    </td>
                    <td className="py-3.5">
                      <Cashback exchange={exchange} />
                    </td>
                    {/* Ставка после возврата - по доле этой самой биржи. Взять
                        одну долю на всех было бы ровнее в вёрстке и неправдой
                        в трёх строках из семи. */}
                    <td
                      className={`py-3.5 font-mono font-black tabular-nums ${
                        live && back > 0 ? "text-accent-cyan" : "text-text-muted"
                      }`}
                    >
                      {rate(exchange.takerRate * (1 - back), locale)}
                    </td>
                    <td className="py-3.5 text-right">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ring-1 ${STATUS_STYLE[exchange.status]}`}
                      >
                        {copy.status[exchange.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <p className="mt-4 text-sm text-text-muted">{copy.note}</p>
        {/* Прямо под таблицей, а не в сноске мелким шрифтом: у одной из бирж
            в списке ставка выше соседей, и это видно с первого взгляда.
            Промолчать здесь - значит проиграть доверие на строке, которую
            читатель проверит первой. */}
        <p className="mt-2 text-sm text-text-muted">{copy.rateNote}</p>
      </Reveal>

      <Reveal delay={0.15}>
        <div className="mt-8 flex flex-col items-start gap-4 rounded-2xl border border-border bg-bg-panel/85 backdrop-blur-xl p-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-bold text-text-primary">{copy.waitlist.title}</p>
            <p className="mt-1 text-sm text-text-secondary">{copy.waitlist.text}</p>
          </div>
          {/* Два канала, потому что просьбы приходят разные: трейдер пишет в
              чат, а площадка или биржа - письмом, и адрес ей нужен раньше,
              чем ссылка на Telegram. */}
          <div className="flex shrink-0 flex-wrap gap-2">
            <a
              href={SOCIAL_LINKS.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-text-primary transition hover:border-accent-cyan/40"
            >
              <Send className="h-4 w-4" />
              {copy.waitlist.button}
            </a>
            <a
              href={`mailto:${PARTNER_EMAIL}`}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-text-secondary transition hover:border-accent-cyan/40 hover:text-text-primary"
            >
              <Mail className="h-4 w-4" />
              {PARTNER_EMAIL}
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
