"use client";

// Кольцо долей: из чего сложился итог и как сделки легли по дням.
//
// Кольцо, а не круг: середина занята главным числом, и человек читает сперва
// его, а доли - потом. Доли берём по модулю: минус на круговой диаграмме
// нарисовать нельзя, зато видно, какую часть оборота он занял.
//
// Дуги разделены зазором и скруглены с концов, а цвет каждой уходит в
// прозрачность к низу: сплошные плоские сектора встык читаются как заливка
// одного пятна, и граница между «убыточными» и «комиссиями» терялась на
// тёмном фоне. Наведение приподнимает дугу и подсвечивает её - так видно, на
// какую долю смотришь.

import { useId, useState } from "react";

export interface Slice {
  key: string;
  label: string;
  /** Величина доли. Отрицательные берём по модулю. */
  value: number;
  color: string;
  /** Что написать в легенде справа от подписи. */
  note?: string;
  /** Цвет заметки: плюс зелёный, минус красный. Нет - обычный. */
  tone?: "up" | "down";
}

export interface DonutProps {
  slices: readonly Slice[];
  size: number;
  /** Толщина кольца. */
  thickness?: number;
  /** Что стоит в середине: главное число и подпись под ним. */
  center?: React.ReactNode;
  /** Зазор между дугами в точках дуги. Ноль - сектора встык. */
  gap?: number;
}

/** Минимальный кусок дуги, чтобы доля в доли процента была видна. */
const MIN_SHARE = 0.006;

export default function Donut({
  slices,
  size,
  thickness = 14,
  center,
  gap = 4,
}: DonutProps) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<string | null>(null);

  const radius = (size - thickness) / 2;
  const circle = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + Math.abs(slice.value), 0);
  const shown = slices.filter((slice) => Math.abs(slice.value) > 0);
  // Зазор съедает длину дуги, и на одной доле он не нужен вовсе: кольцо из
  // одного сектора превращалось в кольцо с зарубкой.
  const cut = shown.length > 1 ? gap : 0;

  let offset = 0;
  const arcs = shown.map((slice) => {
    const share = total > 0 ? Math.abs(slice.value) / total : 0;
    const drawn = share < MIN_SHARE ? MIN_SHARE : share;
    const full = drawn * circle;
    const arc = {
      ...slice,
      share,
      length: Math.max(1, full - cut),
      offset,
    };
    offset += full;
    return arc;
  });

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <defs>
          {arcs.map((arc) => (
            <linearGradient key={arc.key} id={`${uid}-${arc.key}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={arc.color} stopOpacity="1" />
              <stop offset="100%" stopColor={arc.color} stopOpacity="0.62" />
            </linearGradient>
          ))}
        </defs>

        {/* Дорожка: по ней видно, что кольцо целое, даже когда доля одна. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--pane-hover)"
          strokeWidth={thickness}
        />

        {arcs.map((arc) => {
          const lit = hover === arc.key;
          return (
            <circle
              key={arc.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={`url(#${uid}-${arc.key})`}
              strokeWidth={lit ? thickness + 3 : thickness}
              strokeDasharray={`${arc.length} ${circle - arc.length}`}
              strokeDashoffset={-arc.offset}
              strokeLinecap={cut > 0 ? "round" : "butt"}
              onMouseEnter={() => setHover(arc.key)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default transition-[stroke-width,filter] duration-200"
              style={{ filter: lit ? `drop-shadow(0 0 6px ${arc.color})` : undefined }}
            >
              <title>{`${arc.label} · ${Math.round(arc.share * 100)}%`}</title>
            </circle>
          );
        })}
      </svg>

      {center && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          {center}
        </div>
      )}
    </div>
  );
}

/** Легенда кольца: точка цвета, подпись, значение и доля. */
export function DonutLegend({
  slices,
  showShare = true,
  stacked = false,
  compact = false,
  bars = false,
  className = "",
}: {
  slices: readonly Slice[];
  /** Показывать процент доли: у денег он лишний, у дней - главный. */
  showShare?: boolean;
  /**
   * Значение под подписью, а не за ней.
   *
   * В одну строку «Прибыльные +$4 120» помещается только на широкой панели, а
   * на узкой подпись обрезалась до «Прибыльн...». Две строки занимают ту же
   * ширину при любом числе знаков в сумме.
   */
  stacked?: boolean;
  /** Тесный ряд: строки в один уровень, для колонки в три клетки сетки. */
  compact?: boolean;
  /** Полоса доли под строкой: ту же долю, что на кольце, видно и в списке. */
  bars?: boolean;
  className?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.abs(slice.value), 0);

  function tone(slice: Slice): string {
    return slice.tone === "up"
      ? "text-[var(--pane-up)]"
      : slice.tone === "down"
        ? "text-[var(--pane-down)]"
        : "text-[var(--pane-text)]";
  }

  if (stacked) {
    return (
      <ul className={`min-w-0 ${bars ? "space-y-2" : "space-y-1.5"} ${className}`}>
        {slices.map((slice) => {
          const share = total > 0 ? Math.abs(slice.value) / total : 0;
          return (
            <li key={slice.key} className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                  style={{ background: slice.color }}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] leading-tight text-[var(--pane-text-2)]">
                  {slice.label}
                </span>
                {showShare && (
                  <span className="shrink-0 font-mono text-[10px] text-[var(--pane-muted)]">
                    {Math.round(share * 100)}%
                  </span>
                )}
              </div>
              {slice.note && (
                <div
                  className={`pl-4 font-mono text-[13px] font-bold leading-tight ${tone(slice)}`}
                >
                  {slice.note}
                </div>
              )}
              {bars && (
                <div className="ml-4 mt-1 h-1 overflow-hidden rounded-full bg-[var(--pane-hover)]">
                  <span
                    className="block h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${share * 100}%`, background: slice.color }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className={`min-w-0 ${compact ? "space-y-px" : "space-y-1"} ${className}`}>
      {slices.map((slice) => (
        <li key={slice.key} className="flex items-center gap-1.5 text-[11px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} />
          <span className="shrink-0 text-[var(--pane-text-2)]">{slice.label}</span>
          {slice.note && (
            <span className={`ml-auto shrink-0 font-mono text-[11px] font-bold ${tone(slice)}`}>
              {slice.note}
            </span>
          )}
          {showShare && (
            <span
              className={`${slice.note ? "" : "ml-auto"} w-8 shrink-0 text-right font-mono text-[10px] text-[var(--pane-muted)]`}
            >
              {total > 0 ? Math.round((Math.abs(slice.value) / total) * 100) : 0}%
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
