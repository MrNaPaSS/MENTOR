"use client";

// Баланс в маркете: сколько монет, что ждёт получения и до чего осталось
// накопить. Как монеты зарабатываются - под кнопкой: это справка, её читают
// один раз, а баланс смотрят каждый заход.

import { useState } from "react";
import { ChevronDown, Coins, Flame, Gift, Timer, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { useIntlLocale, useT } from "@/lib/i18n";
import { openRewards } from "@/lib/rewards";
import { useRollingNumber } from "@/lib/useRollingNumber";
import CoinIcon from "@/components/app/CoinIcon";

/** Иконки к строкам «Как заработать» - в том же порядке, что строки словаря. */
const EARN_ICONS = [TrendingUp, Flame, TrendingDown, Trophy, Timer];

export default function BalanceCard({
  balance,
  pendingCount,
  pendingTotal,
  goal,
}: {
  balance: number;
  pendingCount: number;
  pendingTotal: number;
  /** Ближайший товар, на который пока не хватает: к нему и тянется полоса. */
  goal: { title: string; price: number } | null;
}) {
  const t = useT();
  const numbers = useIntlLocale();
  // Число докручивается, когда награды забраны: здесь их тоже видно.
  const shown = useRollingNumber(balance) ?? balance;
  const [open, setOpen] = useState(false);
  const pct = goal ? Math.min(100, Math.round((balance / goal.price) * 100)) : 0;

  return (
    <section className="relative overflow-hidden rounded-xl border border-accent-gold/30 bg-[var(--pane-bg)] p-4 shadow-[0_0_28px_-10px_rgba(240,185,11,0.45)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(240,185,11,0.22), transparent 70%)" }}
      />

      <div className="relative flex items-center gap-3">
        {/* Сама монета NMNH, крупно: баланс - это их количество. */}
        <CoinIcon size={54} className="drop-shadow-[0_6px_16px_rgba(0,0,0,0.45)]" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pane-muted)]">
            {t.shop.balance}
          </p>
          <p className="font-mono text-[28px] font-bold leading-none tabular-nums text-[var(--pane-gold)]">
            {shown.toLocaleString(numbers)}
            <span className="ml-1.5 text-[11px] font-bold opacity-60">NMNH</span>
          </p>
        </div>
      </div>

      {pendingCount > 0 && (
        <button
          type="button"
          onClick={openRewards}
          className="relative mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-accent-gold/30 bg-accent-gold/10 px-3 py-2 text-[11px] font-semibold transition-[background-color,transform] duration-150 ease-out hover:bg-accent-gold/15 active:scale-[0.98]"
        >
          <span className="flex items-center gap-1.5 text-[var(--pane-text)]">
            <Gift className="h-3.5 w-3.5 text-[var(--pane-gold)]" />
            {t.shop.waiting(pendingCount)}
          </span>
          <span className="text-[var(--pane-gold)]">
            {t.shop.claim} +{pendingTotal.toLocaleString(numbers)}
          </span>
        </button>
      )}

      {goal && (
        <div className="relative mt-3">
          <div className="flex items-baseline justify-between gap-2 text-[10px]">
            <span className="truncate text-[var(--pane-muted)]">
              {t.shop.goal(goal.title, (goal.price - balance).toLocaleString(numbers))}
            </span>
            <span className="font-mono text-[var(--pane-gold)]">{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--pane-hover)]">
            <div
              className="h-full origin-left rounded-full bg-[var(--pane-gold)] transition-transform duration-700 ease-out"
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="relative mt-3 flex w-full items-center justify-between border-t border-[var(--pane-border)] pt-2 text-[11px] font-semibold text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
      >
        {t.shop.earnToggle}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="relative mt-2 animate-fade-in space-y-1.5 motion-reduce:animate-none">
          {t.shop.earnLines.map((line, i) => {
            const Icon = EARN_ICONS[i] ?? Coins;
            return (
              <li key={line} className="flex items-center gap-2 text-[11px] text-[var(--pane-text)]">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[var(--pane-hover)]">
                  <Icon className="h-3 w-3 text-[var(--pane-gold)]" />
                </span>
                {line}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
