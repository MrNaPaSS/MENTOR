"use client";

// Распределение по R: сколько сделок какого размера в риске.
//
// Столбики считаем в долях от всех сделок с известным риском, а не в штуках:
// «38% сделок лежат в диапазоне от нуля до одного R» говорит о торговле, а
// «14 сделок» - только о том, сколько их было за период.
//
// Отдельно от общего Bars: там нулевая линия посередине и столбики растут в
// обе стороны, а тут все значения положительные - это счётчик, а не деньги.

import type { Bucket } from "@/lib/analytics/advanced";

/** Высота строки с названием корзины: по ней стоит базовая линия. */
const LABEL_H = 14;

export interface RBarsProps {
  buckets: readonly Bucket[];
  height: number;
  /** Деньги словами - для подсказки. */
  money: (value: number) => string;
  /** Число сделок словами - для подсказки. */
  count: (n: number) => string;
}

export default function RBars({ buckets, height, money, count }: RBarsProps) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.trades, 0);
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.trades));
  // Место под процент сверху и подпись корзины снизу: столбик живёт между.
  const field = Math.max(24, height - LABEL_H - 16);

  return (
    <div className="relative" style={{ height }}>
      {/* Базовая линия: без неё прямоугольники разной высоты читаются как
          висящие, а не как счётчик от нуля. */}
      <span
        className="pointer-events-none absolute inset-x-0 border-t border-[var(--pane-border)]"
        style={{ bottom: LABEL_H }}
      />
      <div className="flex h-full items-end gap-1.5">
      {buckets.map((bucket) => {
        const share = total > 0 ? bucket.trades / total : 0;
        const loss = bucket.key.startsWith("<") || bucket.key.startsWith("-");
        const color = loss ? "var(--pane-down)" : "var(--pane-up)";
        const bar = bucket.trades === 0 ? 2 : Math.max(4, (bucket.trades / peak) * field);

        return (
          <div
            key={bucket.key}
            title={`${bucket.key} · ${count(bucket.trades)} · ${bucket.pnl >= 0 ? "+" : ""}${money(bucket.pnl)}`}
            className="flex min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded transition-colors hover:bg-[var(--pane-hover)]"
          >
            <span className="mb-1 font-mono text-[10px] font-bold text-[var(--pane-text-2)]">
              {Math.round(share * 100)}%
            </span>
            <span
              className="w-full rounded-t-md transition-[height] duration-500"
              style={{
                height: bar,
                background: color,
                opacity: bucket.trades === 0 ? 0.25 : 0.85,
              }}
            />
            <span
              className="block w-full truncate text-center text-[8px] leading-none text-[var(--pane-muted)]"
              style={{ height: LABEL_H, paddingTop: 4 }}
            >
              {bucket.key}
            </span>
          </div>
        );
      })}
      </div>
    </div>
  );
}
