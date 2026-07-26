"use client";

import { useMemo } from "react";
import type { DomSnapshot, DomLevel } from "@/lib/api";

interface Props {
  data: DomSnapshot | null;
  /** Подсветка уровней, чей объём кратно выше среднего по стороне. */
  showWalls?: boolean;
}

export function fmtPrice(n: number, tick: number): string {
  // Знаков после запятой ровно столько, сколько несёт шаг агрегации:
  // иначе цены «дрожат» лишними нулями и колонка теряет читаемость.
  const decimals = tick >= 1 ? 0 : Math.min(8, Math.max(0, -Math.floor(Math.log10(tick || 0.01))));
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtSize(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(3);
}

function Row({
  level,
  side,
  maxSize,
  isWall,
  tick,
}: {
  level: DomLevel;
  side: "bid" | "ask";
  maxSize: number;
  isWall: boolean;
  tick: number;
}) {
  const pct = maxSize > 0 ? (level.size / maxSize) * 100 : 0;
  const isBid = side === "bid";
  const barColor = isBid ? "bg-success/20" : "bg-danger/20";
  const textColor = isBid ? "text-success" : "text-danger";

  return (
    <div
      className={`relative grid h-[22px] grid-cols-[1fr_auto_1fr] items-center px-2 font-mono text-[11px] leading-none ${
        level.strong ? "bg-white/[0.04]" : ""
      }`}
      data-testid={`dom-row-${side}`}
    >
      {/* Гистограмма внутри строки: DomRuler=Percents, DomRulerPosition=inside */}
      <div
        className={`absolute inset-y-[1px] ${barColor} ${isBid ? "right-0" : "left-0"} rounded-sm transition-[width] duration-150`}
        style={{ width: `${pct}%` }}
        aria-hidden
      />

      {/* Объём бида — слева, аска — справа (DomDetectVolumesPosition=left) */}
      <span className={`relative z-10 text-left tabular-nums ${isBid ? textColor : "text-transparent"}`}>
        {isBid ? fmtSize(level.size) : ""}
      </span>

      <span
        className={`relative z-10 px-3 tabular-nums ${
          isWall ? "font-semibold text-accent-gold" : "text-text-secondary"
        }`}
      >
        {fmtPrice(level.price, tick)}
      </span>

      <span className={`relative z-10 text-right tabular-nums ${!isBid ? textColor : "text-transparent"}`}>
        {!isBid ? fmtSize(level.size) : ""}
      </span>

      {level.strong && (
        <span
          className={`absolute inset-y-0 w-[2px] ${isBid ? "left-0 bg-success" : "right-0 bg-danger"}`}
          title="Имбаланс: сторона перевешивает противоположную"
          aria-hidden
        />
      )}
    </div>
  );
}

export default function DomLadder({ data, showWalls = true }: Props) {
  const maxSize = useMemo(() => {
    if (!data) return 0;
    // Общий масштаб для обеих сторон — иначе визуально нельзя сравнить
    // плотность бидов и асков, а на скальпинге именно это и нужно.
    return Math.max(
      ...data.bids.map((l) => l.size),
      ...data.asks.map((l) => l.size),
      0,
    );
  }, [data]);

  const bidWalls = useMemo(() => new Set(data?.bid_walls ?? []), [data]);
  const askWalls = useMemo(() => new Set(data?.ask_walls ?? []), [data]);

  if (!data) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-xl border border-border/60 bg-bg-panel">
        <div className="h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
      </div>
    );
  }

  // Аски сверху идут от дальних к ближним — цена растёт снизу вверх,
  // как в любом биржевом стакане.
  const asksDesc = [...data.asks].reverse();

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-bg-panel">
      <div className="grid grid-cols-[1fr_auto_1fr] border-b border-border/60 px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-muted">
        <span>Покупка</span>
        <span className="px-3">Цена</span>
        <span className="text-right">Продажа</span>
      </div>

      <div>
        {asksDesc.map((l) => (
          <Row
            key={`a-${l.price}`}
            level={l}
            side="ask"
            maxSize={maxSize}
            isWall={showWalls && askWalls.has(l.price)}
            tick={data.tick}
          />
        ))}
      </div>

      {/* Спред — DomShowSpreadPrices=true */}
      <div className="flex items-center justify-between border-y border-border/60 bg-bg-card px-3 py-1.5 font-mono text-[11px]">
        <span className="text-text-muted">спред</span>
        <span className="tabular-nums text-text-primary">
          {fmtPrice(data.spread, data.tick)}
        </span>
        <span className="tabular-nums text-text-muted">{data.spread_bp.toFixed(1)} б.п.</span>
      </div>

      <div>
        {data.bids.map((l) => (
          <Row
            key={`b-${l.price}`}
            level={l}
            side="bid"
            maxSize={maxSize}
            isWall={showWalls && bidWalls.has(l.price)}
            tick={data.tick}
          />
        ))}
      </div>
    </div>
  );
}
