"use client";

import { Send } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { CASHBACK_TIERS, EXCHANGES, type ExchangeStatus } from "@/lib/broker/program";
import { rate, share } from "@/lib/broker/format";
import { SOCIAL_LINKS } from "@/lib/content";
import { useIntlLocale, useT } from "@/lib/i18n";

/** Цвет метки статуса. Работающая биржа зелёная, остальные приглушены. */
const STATUS_STYLE: Record<ExchangeStatus, string> = {
  live: "bg-success/10 text-success ring-success/25",
  connecting: "bg-accent-gold/10 text-accent-gold ring-accent-gold/25",
  planned: "bg-bg-panel text-text-muted ring-border",
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
  const locale = useIntlLocale();
  const copy = t.broker.exchanges;
  const baseShare = CASHBACK_TIERS[0].share;

  return (
    <section id="exchanges" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      <Reveal className="mt-14">
        <div className="overflow-x-auto rounded-2xl border border-border bg-bg-card/50 p-5 md:p-6">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-text-muted">
                <th className="pb-3 font-semibold">{copy.columns.exchange}</th>
                <th className="pb-3 font-semibold">{copy.columns.maker}</th>
                <th className="pb-3 font-semibold">{copy.columns.taker}</th>
                <th className="pb-3 font-semibold">{copy.columns.effective}</th>
                <th className="pb-3 text-right font-semibold">{copy.columns.status}</th>
              </tr>
            </thead>
            <tbody>
              {EXCHANGES.map((exchange) => {
                const live = exchange.status === "live";
                return (
                  <tr key={exchange.id} className="border-t border-border">
                    <td className="py-3.5 font-semibold text-text-primary">{exchange.name}</td>
                    <td className="py-3.5 font-mono tabular-nums text-text-secondary">
                      {rate(exchange.makerRate, locale)}
                    </td>
                    <td className="py-3.5 font-mono tabular-nums text-text-secondary">
                      {rate(exchange.takerRate, locale)}
                    </td>
                    {/* Ставка после возврата - на базовом уровне. Считать её
                        по верхнему было бы красивее и нечестно: верхний берут
                        единицы. */}
                    <td
                      className={`py-3.5 font-mono font-black tabular-nums ${
                        live ? "text-accent-cyan" : "text-text-muted"
                      }`}
                    >
                      {rate(exchange.takerRate * (1 - baseShare), locale)}
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
        <p className="mt-4 text-sm text-text-muted">{copy.note(share(baseShare, locale))}</p>
        {/* Прямо под таблицей, а не в сноске мелким шрифтом: у одной из бирж
            в списке ставка выше соседей, и это видно с первого взгляда.
            Промолчать здесь - значит проиграть доверие на строке, которую
            читатель проверит первой. */}
        <p className="mt-2 text-sm text-text-muted">{copy.rateNote}</p>
      </Reveal>

      <Reveal delay={0.15}>
        <div className="mt-8 flex flex-col items-start gap-4 rounded-2xl border border-border bg-bg-panel/40 p-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-bold text-text-primary">{copy.waitlist.title}</p>
            <p className="mt-1 text-sm text-text-secondary">{copy.waitlist.text}</p>
          </div>
          <a
            href={SOCIAL_LINKS.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-text-primary transition hover:border-accent-cyan/40"
          >
            <Send className="h-4 w-4" />
            {copy.waitlist.button}
          </a>
        </div>
      </Reveal>
    </section>
  );
}
