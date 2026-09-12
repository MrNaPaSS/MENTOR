"use client";

// Итоги по результату (R) списком: тот же разрез, что столбиками, но числами.
//
// Столбики отвечают на вопрос «какая форма», список - на вопрос «сколько
// именно». Держим оба: по форме видно перекос, по числам считают, и требовать
// от одного графика обеих ролей значит испортить обе.

import { R_BUCKETS, type Bucket } from "@/lib/analytics/advanced";

export interface RListProps {
  buckets: readonly Bucket[];
  /** Название корзины словами. */
  name: (key: string) => string;
  money: (value: number) => string;
  height?: number;
}

export default function RList({ buckets, name, money, height }: RListProps) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.trades, 0);

  return (
    <div className="space-y-0.5" style={height ? { minHeight: height } : undefined}>
      {[...buckets].reverse().map((bucket) => {
        const share = total > 0 ? bucket.trades / total : 0;
        // Знак корзины берём из её границ, а не из названия: подпись
        // переводится, а «до нуля» остаётся убытком на любом языке.
        const edge = R_BUCKETS.find((one) => one.key === bucket.key)?.to ?? 0;
        const loss = edge <= 0;

        return (
          <div
            key={bucket.key}
            title={`${name(bucket.key)} · ${bucket.trades} · ${bucket.pnl >= 0 ? "+" : ""}${money(bucket.pnl)}`}
            className="flex items-center gap-2 rounded-lg px-2 py-[5px] text-[11px] odd:bg-[var(--pane-hover)]"
          >
            <span className="min-w-0 flex-1 truncate text-[var(--pane-text-2)]">
              {name(bucket.key)}
            </span>
            <span
              className={`w-10 text-right font-mono font-bold ${
                loss ? "text-[var(--pane-down)]" : "text-[var(--pane-up)]"
              }`}
            >
              {Math.round(share * 100)}%
            </span>
            <span className="w-7 text-right font-mono text-[10px] text-[var(--pane-muted)]">
              {bucket.trades}
            </span>
          </div>
        );
      })}
    </div>
  );
}
