"use client";

import { useMemo, useState } from "react";
import { ArrowDown, Info } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import {
  monthlyCommission,
  outcomeFor,
  planOutcome,
  yearlyAdvantage,
} from "@/lib/broker/economics";
import { EXCHANGES, DEFAULT_EXCHANGE, exchangeById } from "@/lib/broker/program";
import { RIVAL_TOP } from "@/lib/broker/rivals";
import { compactMoney, money, moneyPrecise, rate, share } from "@/lib/broker/format";
import { useLocale, useT } from "@/lib/i18n";

/** Границы оборота на слайдере: от новичка до объёма фонда. */
const MIN_VOLUME = 10_000;
const MAX_VOLUME = 50_000_000;

/**
 * Положение ручки в оборот.
 *
 * Шкала логарифмическая: от десяти тысяч до пятидесяти миллионов линейно
 * ползунок был бы бесполезен - весь диапазон реальных оборотов сплющился бы
 * в первый процент хода. Результат округляется до двух значащих цифр, чтобы
 * под ручкой стояло «$250 000», а не «$247 361».
 */
function positionToVolume(position: number): number {
  const ratio = Math.log(MAX_VOLUME / MIN_VOLUME);
  const raw = MIN_VOLUME * Math.exp((position / 100) * ratio);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / magnitude) * magnitude;
}

export default function SavingsCalculator() {
  const t = useT();
  const locale = useLocale();

  // Стартовые значения - не самые выгодные для нас, а самые частые: полмиллиона
  // оборота и торговля по рынку. Подкрученный старт калькулятор обесценивает.
  const [position, setPosition] = useState(52);
  const [takerPercent, setTakerPercent] = useState(80);
  const [exchangeId, setExchangeId] = useState(DEFAULT_EXCHANGE.id);

  const volume = positionToVolume(position);
  const exchange = exchangeById(exchangeId);

  const view = useMemo(() => {
    const takerShare = takerPercent / 100;
    const ours = outcomeFor(exchange, { monthlyVolume: volume, takerShare });

    // Подписочный брокер считается на ставке своей биржи, а не нашей: сравнение
    // должно отвечать на вопрос «где выгоднее мне», а не подгонять чужую
    // модель под удобные нам цифры.
    const rivalExchange = exchangeById("binance");
    const rivalRate =
      rivalExchange.takerRate * takerShare + rivalExchange.makerRate * (1 - takerShare);
    const theirs = planOutcome(monthlyCommission(volume, rivalRate), RIVAL_TOP);

    return { ours, theirs, advantage: yearlyAdvantage(ours, theirs) };
  }, [exchange, takerPercent, volume]);

  const { ours, theirs, advantage } = view;

  return (
    <section id="calculator" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading
        eyebrow={t.broker.calculator.eyebrow}
        title={t.broker.calculator.title}
        subtitle={t.broker.calculator.subtitle}
      />

      <Reveal className="mt-14">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Ввод */}
          <div className="rounded-2xl border border-border bg-bg-card/95 backdrop-blur-sm p-5 md:p-6">
            <label className="block">
              <span className="text-sm font-semibold text-text-primary">
                {t.broker.calculator.volumeLabel}
              </span>
              <span className="mt-3 block font-mono text-4xl font-black tabular-nums text-text-primary">
                {money(volume, locale)}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={position}
                onChange={(e) => setPosition(Number(e.target.value))}
                className="mt-3 w-full accent-[rgb(var(--accent-cyan))]"
                aria-label={t.broker.calculator.volumeLabel}
              />
              <span className="mt-1 flex justify-between text-xs text-text-muted">
                <span>{compactMoney(MIN_VOLUME, locale)}</span>
                <span>{compactMoney(MAX_VOLUME, locale)}</span>
              </span>
              <span className="mt-2 block text-xs text-text-muted">
                {t.broker.calculator.volumeHint}
              </span>
            </label>

            <label className="mt-7 block">
              <span className="text-sm font-semibold text-text-primary">
                {t.broker.calculator.styleLabel}
              </span>
              <span className="mt-3 flex items-baseline justify-between">
                <span className="font-mono text-2xl font-black tabular-nums text-text-primary">
                  {takerPercent}%
                </span>
                <span className="text-xs text-text-muted">{t.broker.calculator.styleTaker}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={takerPercent}
                onChange={(e) => setTakerPercent(Number(e.target.value))}
                className="mt-3 w-full accent-[rgb(var(--accent-cyan))]"
                aria-label={t.broker.calculator.styleLabel}
              />
              <span className="mt-1 flex justify-between text-xs text-text-muted">
                <span>{t.broker.calculator.styleMaker}</span>
                <span>{t.broker.calculator.styleTaker}</span>
              </span>
              <span className="mt-2 block text-xs text-text-muted">
                {t.broker.calculator.styleHint}
              </span>
            </label>

            <div className="mt-7">
              <span className="text-sm font-semibold text-text-primary">
                {t.broker.calculator.exchangeLabel}
              </span>
              {/* Считать можно и по неподключённой бирже: человек хочет знать,
                  что его ждёт. Метка «скоро» стоит прямо на кнопке, поэтому
                  расчёт не превращается в обещание. */}
              <div className="mt-3 flex flex-wrap gap-2">
                {EXCHANGES.map((item) => {
                  const active = item.id === exchange.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setExchangeId(item.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        active
                          ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
                          : "border-border text-text-secondary hover:text-text-primary"
                      }`}
                      aria-pressed={active}
                    >
                      {item.name}
                      {item.status !== "live" && (
                        <span className="rounded-md bg-bg-panel px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                          {t.broker.calculator.exchangeSoon}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Результат */}
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <ResultCard
              label={t.broker.calculator.results.commission}
              value={moneyPrecise(ours.commission, locale)}
              hint={t.broker.calculator.results.commissionHint(rate(ours.rate, locale))}
            />
            <ResultCard
              label={t.broker.calculator.results.cashback}
              value={moneyPrecise(ours.cashback, locale)}
              hint={t.broker.calculator.results.cashbackHint(share(ours.share, locale))}
              accent
            />
            <ResultCard
              label={t.broker.calculator.results.effective}
              value={rate(ours.effectiveRate, locale)}
              hint={t.broker.calculator.results.effectiveHint(
                rate(ours.rate, locale),
                rate(ours.effectiveRate, locale),
              )}
            />
            <ResultCard
              label={t.broker.calculator.results.yearly}
              value={money(ours.yearly, locale)}
              hint={t.broker.calculator.results.yearlyHint}
              accent
            />
          </div>
        </div>
      </Reveal>

      {/* Сравнение с подпиской */}
      <Reveal delay={0.15} className="mt-6">
        <div className="rounded-2xl border border-border bg-bg-card/95 backdrop-blur-sm p-5 md:p-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-lg font-bold text-text-primary">
              {t.broker.calculator.versus.title}
            </h3>
            <p className="text-sm text-text-muted">{t.broker.calculator.versus.subtitle}</p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
            <div className="rounded-xl border border-border/70 bg-bg-panel/80 p-4">
              <Row label={t.broker.calculator.versus.theirCashback} value={moneyPrecise(theirs.cashback, locale)} />
              <Row label={t.broker.calculator.versus.theirPrice} value={`− ${moneyPrecise(theirs.price, locale)}`} />
              <div className="my-2.5 h-px bg-border" />
              <Row
                label={t.broker.calculator.versus.theirNet}
                value={moneyPrecise(theirs.net, locale)}
                tone={theirs.net < 0 ? "danger" : "plain"}
                strong
              />
            </div>

            <div className="grid place-items-center text-text-muted md:rotate-[-90deg]">
              <ArrowDown className="h-5 w-5" />
            </div>

            <div className="rounded-xl border border-accent-cyan/30 bg-accent-cyan/5 p-4">
              <Row label={t.broker.calculator.results.cashback} value={moneyPrecise(ours.cashback, locale)} />
              <Row label={t.broker.calculator.versus.theirPrice} value={moneyPrecise(0, locale)} />
              <div className="my-2.5 h-px bg-accent-cyan/20" />
              <Row
                label={t.broker.calculator.versus.ourNet}
                value={moneyPrecise(ours.cashback, locale)}
                tone="accent"
                strong
              />
            </div>
          </div>

          <p
            className={`mt-5 text-center text-lg font-bold ${
              advantage >= 0 ? "text-accent-cyan" : "text-text-secondary"
            }`}
          >
            {advantage >= 0
              ? t.broker.calculator.versus.advantageWin(money(Math.abs(advantage), locale))
              : t.broker.calculator.versus.advantageLose(money(Math.abs(advantage), locale))}
          </p>

          {theirs.net < 0 && (
            <p className="mt-2 text-center text-sm text-text-muted">
              {t.broker.calculator.versus.lossNote}
            </p>
          )}
        </div>
      </Reveal>

      <Reveal delay={0.2}>
        <p className="mx-auto mt-6 flex max-w-2xl items-start gap-2 text-center text-xs leading-relaxed text-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="text-left">{t.broker.calculator.disclaimer}</span>
        </p>
      </Reveal>
    </section>
  );
}

interface ResultCardProps {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}

function ResultCard({ label, value, hint, accent = false }: ResultCardProps) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        accent ? "border-accent-cyan/30 bg-accent-cyan/5" : "border-border bg-bg-card/40"
      }`}
    >
      <div className="text-sm text-text-secondary">{label}</div>
      <div
        className={`mt-2 font-mono text-3xl font-black tabular-nums ${
          accent ? "text-accent-cyan" : "text-text-primary"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-text-muted">{hint}</div>
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  tone?: "plain" | "accent" | "danger";
  strong?: boolean;
}

function Row({ label, value, tone = "plain", strong = false }: RowProps) {
  const color =
    tone === "accent" ? "text-accent-cyan" : tone === "danger" ? "text-danger" : "text-text-primary";
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`font-mono tabular-nums ${strong ? "text-lg font-black" : "text-sm"} ${color}`}>
        {value}
      </span>
    </div>
  );
}
