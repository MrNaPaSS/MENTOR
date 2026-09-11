"use client";

// Цели месяца: полоса до цели и объёмная картинка каждой.
//
// Награда цели видна и до выполнения, приглушённой: знать, что получишь, -
// половина смысла цели. Выполненная подсвечивается зелёным целиком.

/* eslint-disable @next/next/no-img-element */

import { CheckCircle2 } from "lucide-react";
import { useIntlLocale, useT } from "@/lib/i18n";
import { goalArt, XP_ART, type Goal } from "@/lib/analytics/rewards";

/** Крупные числа коротко: оборот в сотни тысяч в строку «180K/250K» влезает, а целиком - нет. */
function short(n: number, locale: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000).toLocaleString(locale)}K`;
  return n.toLocaleString(locale);
}

export default function GoalsPanel({ goals }: { goals: Goal[] }) {
  const t = useT();
  const numbers = useIntlLocale();
  const done = goals.filter((g) => g.unlocked).length;

  return (
    <section className="h-full rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3">
      <header className="mb-3 flex items-center gap-2">
        <img src={XP_ART.goals} alt="" className="h-7 w-7" />
        <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{t.analytics.goalsTitle}</h2>
        <span className="ml-auto font-mono text-xs font-bold tabular-nums text-[var(--pane-gold)]">
          {done}/{goals.length}
        </span>
      </header>

      <ul className="space-y-2">
        {goals.map((goal) => {
          const pct = goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0;
          const copy = t.analytics.goals[goal.id];
          return (
            <li
              key={goal.id}
              className={`flex items-center gap-3 rounded-xl border py-2 pl-3 pr-2 transition-colors duration-200 ease-out ${
                goal.unlocked
                  ? "border-[var(--pane-up)]/30 bg-[var(--pane-up)]/[0.05]"
                  : "border-[var(--pane-border)] bg-[var(--pane-hover)]"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--pane-text)]">
                    {copy.label}
                  </span>
                  {goal.unlocked ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--pane-up)]" />
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--pane-muted)]">
                      {short(goal.current, numbers)}/{short(goal.target, numbers)}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--pane-bg)]">
                  <div
                    className="h-full origin-left rounded-full transition-transform duration-700 ease-out"
                    style={{ transform: `scaleX(${pct / 100})`, background: goal.color }}
                  />
                </div>
                <p
                  className={`mt-1 truncate text-[10px] ${
                    goal.unlocked ? "text-[var(--pane-up)]" : "text-[var(--pane-muted)]/70"
                  }`}
                >
                  {copy.reward}
                </p>
              </div>
              <img
                src={goalArt(goal.id)}
                alt=""
                className={`-my-3 h-16 w-16 shrink-0 drop-shadow-[0_6px_12px_rgba(0,0,0,0.25)] transition-[filter,opacity] duration-200 ease-out ${
                  goal.unlocked ? "" : "opacity-75 saturate-50"
                }`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
