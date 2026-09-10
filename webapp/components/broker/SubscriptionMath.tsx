"use client";

import { Check, Lock, ShieldAlert } from "lucide-react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { subscriptionBreakeven, upgradeBreakeven } from "@/lib/broker/economics";
import { FEATURE_ROWS, RIVAL_PLANS } from "@/lib/broker/rivals";
import { compactMoney, share } from "@/lib/broker/format";
import { useIntlLocale, useT } from "@/lib/i18n";

/**
 * Ставка, на которой считаются пороги: 0,05% - тейкер базового уровня на
 * биржах, где подписочные брокеры и работают. Ниже ставка - выше порог, так
 * что для них это самое благоприятное допущение из возможных.
 */
const REFERENCE_RATE = 0.0005;

/** Имя ступени с заглавной: в прайсах они пишутся именно так. */
function planName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Разбор подписочной модели.
 *
 * Единственный раздел страницы, который спорит, а не рассказывает. Поэтому он
 * построен на арифметике, а не на прилагательных: каждое утверждение здесь -
 * это число, которое читатель может пересчитать сам, и функции, которыми они
 * считаются, покрыты тестами.
 */
export default function SubscriptionMath() {
  const t = useT();
  const locale = useIntlLocale();
  const copy = t.broker.plans;

  return (
    <section id="plans" className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.subtitle} />

      {/* 1. Когда абонплата отбивается возвратом */}
      <Reveal className="mt-14">
        <div className="rounded-2xl border border-border bg-bg-card/80 p-5 md:p-6">
          <h3 className="text-lg font-bold text-text-primary">{copy.breakeven.title}</h3>
          <p className="mt-1 text-sm text-text-muted">{copy.breakeven.subtitle}</p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-text-muted">
                  <th className="pb-3 font-semibold">{copy.breakeven.planColumn}</th>
                  <th className="pb-3 font-semibold">{copy.breakeven.shareColumn}</th>
                  <th className="pb-3 text-right font-semibold">{copy.breakeven.volumeColumn}</th>
                </tr>
              </thead>
              <tbody>
                {RIVAL_PLANS.map((plan) => (
                  <tr key={plan.id} className="border-t border-border">
                    <td className="py-3">
                      <span className="font-semibold text-text-primary">{planName(plan.id)}</span>
                      <span className="ml-2 font-mono text-sm text-text-muted">
                        {plan.price} {copy.breakeven.priceSuffix}
                      </span>
                    </td>
                    <td className="py-3 font-mono tabular-nums text-text-secondary">
                      {share(plan.share, locale)}
                    </td>
                    <td className="py-3 text-right font-mono text-lg font-black tabular-nums text-warning">
                      {compactMoney(subscriptionBreakeven(plan, REFERENCE_RATE), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      {/* 2. Когда окупается переход на тариф выше */}
      <Reveal delay={0.1} className="mt-6">
        <div className="rounded-2xl border border-border bg-bg-card/80 p-5 md:p-6">
          <h3 className="text-lg font-bold text-text-primary">{copy.upgrade.title}</h3>
          <p className="mt-1 text-sm text-text-muted">{copy.upgrade.subtitle}</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {RIVAL_PLANS.slice(0, -1).map((from, i) => {
              const to = RIVAL_PLANS[i + 1];
              const volume = upgradeBreakeven(from, to, REFERENCE_RATE);
              return (
                <div key={to.id} className="rounded-xl border border-border/70 bg-bg-panel/40 p-4">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm text-text-secondary">
                    <span>{copy.upgrade.from}</span>
                    <span className="font-semibold text-text-primary">{planName(from.id)}</span>
                    <span>{copy.upgrade.to}</span>
                    <span className="font-semibold text-text-primary">{planName(to.id)}</span>
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    +{share(to.share - from.share, locale)} · +{to.price - from.price}{" "}
                    {copy.breakeven.priceSuffix}
                  </div>
                  <div className="mt-3 text-xs uppercase tracking-wider text-text-muted">
                    {copy.upgrade.volume}
                  </div>
                  <div className="font-mono text-3xl font-black tabular-nums text-warning">
                    {compactMoney(volume, locale)}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-sm leading-relaxed text-text-secondary">{copy.upgrade.verdict}</p>
        </div>
      </Reveal>

      {/* 3. Что режут по ступеням */}
      <Reveal delay={0.15} className="mt-6">
        <div className="rounded-2xl border border-border bg-bg-card/80 p-5 md:p-6">
          <h3 className="text-lg font-bold text-text-primary">{copy.cuts.title}</h3>
          <p className="mt-1 text-sm text-text-muted">{copy.cuts.subtitle}</p>

          <ul className="mt-5 divide-y divide-border">
            {FEATURE_ROWS.map((row) => {
              const plan = RIVAL_PLANS[row.fromPlan];
              const key = row.id as keyof typeof copy.cuts.rows;
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
                >
                  <span className="text-sm text-text-primary">{copy.cuts.rows[key]}</span>
                  <span className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                      <Lock className="h-3.5 w-3.5" />
                      {copy.cuts.lockedOn(planName(plan.id))}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-2 py-1 text-xs font-bold text-success">
                      <Check className="h-3.5 w-3.5" />
                      {copy.cuts.ours}: {copy.cuts.oursValue}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Вердикт. Отдельной плашкой и другим цветом: это не ещё одна
              строка сравнения, а единственное место, где мы говорим, что так
              делать нельзя. */}
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-5 sm:flex-row">
            <ShieldAlert className="h-6 w-6 shrink-0 text-danger" />
            <div>
              <p className="font-bold text-text-primary">{copy.cuts.verdict.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                {copy.cuts.verdict.text}
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
