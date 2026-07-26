"use client";

import { useMemo } from "react";
import type { DomTrade } from "@/lib/api";
import { fmtPrice, fmtVol } from "./DomTrader";

interface Props {
  trades: DomTrade[];
  tick: number;
  /** Во сколько раз сделка должна превышать среднюю, чтобы считаться крупной. */
  bigFactor?: number;
  rows?: number;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export default function Tape({ trades, tick, bigFactor = 4, rows = 26 }: Props) {
  // Порог крупной сделки считаем от текущей ленты, а не фиксированным числом:
  // у BTC и DOGE объёмы отличаются на порядки, константа не подошла бы обеим.
  const bigThreshold = useMemo(() => {
    if (!trades.length) return Infinity;
    const avg = trades.reduce((s, t) => s + t.qty, 0) / trades.length;
    return avg * bigFactor;
  }, [trades, bigFactor]);

  const visible = trades.slice(0, rows);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-panel">
      <div className="grid grid-cols-[auto_1fr_auto] border-b border-border/60 px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted">
        <span>Время</span>
        <span className="text-center">Цена</span>
        <span className="text-right">Объём</span>
      </div>

      {visible.length === 0 ? (
        <div className="px-3 py-6 text-center text-[11px] text-text-muted">Лента пуста</div>
      ) : (
        visible.map((t, i) => {
          const big = t.qty >= bigThreshold;
          return (
            <div
              key={`${t.time}-${i}`}
              className={`grid h-[19px] grid-cols-[auto_1fr_auto] items-center px-2 font-mono text-[11px] leading-none ${
                big ? (t.isBuy ? "bg-success/10" : "bg-danger/10") : ""
              }`}
              data-testid="tape-row"
            >
              <span className="text-text-muted tabular-nums">{fmtTime(t.time)}</span>
              <span
                className={`text-center tabular-nums ${t.isBuy ? "text-success" : "text-danger"}`}
              >
                {fmtPrice(t.price, tick)}
              </span>
              <span
                className={`text-right tabular-nums ${
                  big ? "font-semibold text-text-primary" : "text-text-secondary"
                }`}
              >
                {fmtVol(t.qty)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
