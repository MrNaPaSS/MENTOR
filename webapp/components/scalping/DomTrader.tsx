"use client";

import { useMemo } from "react";
import type { DomSnapshot } from "@/lib/api";
import {
  cellTotal,
  clusterPriceRange,
  maxCell,
  snapPrice,
  topCells,
  type Bucket,
} from "@/lib/clusters";

interface Props {
  data: DomSnapshot | null;
  /** Исторические кластеры объёма, старые слева. */
  buckets: Bucket[];
  /** Показывать объёмы в долларах, а не в базовой монете. */
  notional?: boolean;
  rowHeight?: number;
}

const ROW_H = 15;

export function fmtPrice(n: number, tick: number): string {
  const decimals = tick >= 1 ? 0 : Math.min(8, Math.max(0, -Math.floor(Math.log10(tick || 0.01))));
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Компактная запись объёма: 917K, 1,71M — как в терминале. */
export function fmtVol(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(".", ",") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  if (n >= 100) return String(Math.round(n));
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(3);
}

function fmtBucketTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function DomTrader({ data, buckets, notional = true, rowHeight = ROW_H }: Props) {
  // Ценовая шкала общая для стакана и кластеров — иначе колонки истории
  // не встанут напротив своих уровней, и картина будет врать.
  const rows = useMemo(() => {
    if (!data) return [];
    const tick = data.tick || 0.01;
    const bookPrices = [...data.bids, ...data.asks].map((l) => l.price);
    if (!bookPrices.length) return [];

    let min = Math.min(...bookPrices);
    let max = Math.max(...bookPrices);

    const clusters = clusterPriceRange(buckets);
    if (clusters) {
      min = Math.min(min, clusters.min);
      max = Math.max(max, clusters.max);
    }

    const out: number[] = [];
    // Сверху вниз: дорогие цены первыми, как в любом стакане.
    for (let p = max; p >= min - tick / 2; p -= tick) {
      out.push(snapPrice(p, tick));
      if (out.length > 400) break; // защита от вырожденного шага
    }
    return out;
  }, [data, buckets]);

  const bidMap = useMemo(
    () => new Map((data?.bids ?? []).map((l) => [snapPrice(l.price, data?.tick ?? 0), l])),
    [data],
  );
  const askMap = useMemo(
    () => new Map((data?.asks ?? []).map((l) => [snapPrice(l.price, data?.tick ?? 0), l])),
    [data],
  );

  const peakBook = useMemo(() => {
    if (!data) return 0;
    return Math.max(...data.bids.map((l) => l.size), ...data.asks.map((l) => l.size), 0);
  }, [data]);

  const peakCell = useMemo(() => maxCell(buckets), [buckets]);

  // Оранжевым помечаем верхушку — но только когда есть из чего выбирать.
  // На трёх ячейках «крупнейшие кластеры» подсветили бы всё подряд.
  const hot = useMemo(() => {
    const cells = buckets.reduce((n, b) => n + b.cells.size, 0);
    if (cells < 12) return new Set<string>();
    return topCells(buckets, Math.max(3, Math.round(cells * 0.05)));
  }, [buckets]);

  const bidWalls = useMemo(() => new Set(data?.bid_walls ?? []), [data]);
  const askWalls = useMemo(() => new Set(data?.ask_walls ?? []), [data]);

  if (!data) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-xl border border-border/60 bg-bg-panel">
        <div className="h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
      </div>
    );
  }

  const mult = notional ? data.mid : 1;

  // Колонки истории делят свободное место поровну, стакан держит фиксированную
  // ширину: цена и объёмы должны стоять ровно, чтобы читаться на потоке.
  const gridCols = buckets.length
    ? `repeat(${buckets.length}, minmax(44px, 1fr)) 96px 92px 96px`
    : `1fr 96px 92px 96px`;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-deep">
      {/* ── Шапка ───────────────────────────────────────────────────── */}
      <div
        className="grid border-b border-border/60 bg-bg-panel text-[9px] uppercase tracking-wider text-text-muted"
        style={{ gridTemplateColumns: gridCols }}
      >
        {buckets.length === 0 && <span className="px-2 py-1.5">История</span>}
        {buckets.map((b) => (
          <span key={b.start} className="px-1 py-1.5 text-center">
            {fmtBucketTime(b.start)}
          </span>
        ))}
        <span className="px-2 py-1.5 text-right">Покупка</span>
        <span className="px-1 py-1.5 text-center">Цена</span>
        <span className="px-2 py-1.5">Продажа</span>
      </div>

      {/* ── Строки ──────────────────────────────────────────────────── */}
      {rows.map((price) => {
        const bid = bidMap.get(price);
        const ask = askMap.get(price);
        const isSpread = price > data.best_bid && price < data.best_ask;
        const isWall = bidWalls.has(price) || askWalls.has(price);

        return (
          <div
            key={price}
            className="grid border-b border-white/[0.02] font-mono text-[10px] leading-none"
            style={{ gridTemplateColumns: gridCols, height: rowHeight }}
            data-testid="dom-trader-row"
          >
            {buckets.length === 0 && <span />}
            {buckets.map((b) => {
              const cell = b.cells.get(price);
              if (!cell) return <span key={b.start} className="border-r border-white/[0.02]" />;

              const total = cellTotal(cell);
              const isHot = hot.has(`${b.start}:${price}`);
              const buyDominant = cell.buy >= cell.sell;
              const alpha = peakCell > 0 ? Math.min(0.8, Math.sqrt(total / peakCell) * 0.8) : 0;
              const rgb = buyDominant ? "14, 203, 129" : "246, 70, 93";

              return (
                <span
                  key={b.start}
                  className={`flex items-center justify-end border-r border-white/[0.02] px-1.5 tabular-nums ${
                    isHot ? "font-semibold text-black" : "text-text-primary"
                  }`}
                  style={{
                    backgroundColor: isHot ? "#F0B90B" : `rgba(${rgb}, ${alpha.toFixed(3)})`,
                  }}
                  title={`покупки ${fmtVol(cell.buy * mult)} / продажи ${fmtVol(cell.sell * mult)}`}
                >
                  {fmtVol(total * mult)}
                </span>
              );
            })}

            {/* Покупка */}
            <span className="relative flex items-center justify-end px-1.5 tabular-nums text-success">
              {bid && (
                <>
                  <span
                    className="absolute inset-y-0 right-0 bg-success/20"
                    style={{ width: `${peakBook ? (bid.size / peakBook) * 100 : 0}%` }}
                    aria-hidden
                  />
                  <span className={`relative ${bid.strong ? "font-semibold" : ""}`}>
                    {fmtVol(bid.size * mult)}
                  </span>
                </>
              )}
            </span>

            {/* Цена */}
            <span
              className={`flex items-center justify-center tabular-nums ${
                isSpread
                  ? "bg-white/[0.08] font-semibold text-text-primary"
                  : isWall
                    ? "bg-accent-gold/25 font-semibold text-accent-gold"
                    : ask
                      ? "bg-danger/[0.10] text-text-secondary"
                      : bid
                        ? "bg-success/[0.10] text-text-secondary"
                        : "text-text-muted"
              }`}
            >
              {fmtPrice(price, data.tick)}
            </span>

            {/* Продажа */}
            <span className="relative flex items-center px-1.5 tabular-nums text-danger">
              {ask && (
                <>
                  <span
                    className="absolute inset-y-0 left-0 bg-danger/20"
                    style={{ width: `${peakBook ? (ask.size / peakBook) * 100 : 0}%` }}
                    aria-hidden
                  />
                  <span className={`relative ${ask.strong ? "font-semibold" : ""}`}>
                    {fmtVol(ask.size * mult)}
                  </span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
