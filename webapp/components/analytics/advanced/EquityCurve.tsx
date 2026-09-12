"use client";

// Кривая капитала: как рос счёт от сделки к сделке.
//
// Рисуем сами, а не библиотекой: линия здесь одна, зато нужна подсказка о
// конкретной сделке под курсором, а чужой график ради этого тянет свой пакет
// и свою тему. Точки равномерны по номеру сделки, а не по времени: между
// сделками бывают недели, и на шкале времени активная неделя сжималась бы в
// точку.

import { useMemo, useRef, useState } from "react";
import type { EquityPoint } from "@/lib/analytics/advanced";

/** Поля вокруг линии: под подпись оси и чтобы линия не липла к рамке. */
const PAD = { top: 10, right: 8, bottom: 16, left: 8 };

export interface EquityCurveProps {
  points: readonly EquityPoint[];
  height: number;
  /** Деньги словами: форматирование живёт в разделе, а не здесь. */
  money: (value: number) => string;
  /** Дата словами. */
  day: (ms: number) => string;
  labelTrade: string;
  labelResult: string;
  empty: string;
}

export default function EquityCurve({
  points,
  height,
  money,
  day,
  labelTrade,
  labelResult,
  empty,
}: EquityCurveProps) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const view = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    // Ноль всегда в поле зрения: без него растущая кривая висит в воздухе, и
    // не видно, что счёт вообще в плюсе.
    const top = Math.max(0, ...values);
    const bottom = Math.min(0, ...values);
    const span = top - bottom || 1;
    const stepX = points.length > 1 ? (100 - PAD.left - PAD.right) / (points.length - 1) : 0;

    const xy = points.map((point, i) => ({
      x: PAD.left + stepX * i,
      y: PAD.top + ((top - point.value) / span) * (100 - PAD.top - PAD.bottom),
      point,
    }));
    return { xy, zeroY: PAD.top + (top / span) * (100 - PAD.top - PAD.bottom) };
  }, [points]);

  if (!view) {
    return (
      <div
        className="grid place-items-center text-[11px] text-[var(--pane-muted)]"
        style={{ height }}
      >
        {empty}
      </div>
    );
  }

  const { xy, zeroY } = view;
  const last = xy[xy.length - 1].point.value;
  const up = last >= 0;
  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const area = `${line} L${xy[xy.length - 1].x} ${zeroY} L${xy[0].x} ${zeroY} Z`;
  const current = hover === null ? null : xy[hover];

  function pick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || xy.length === 0) return;
    const share = (event.clientX - rect.left) / rect.width;
    const index = Math.round(share * (xy.length - 1));
    setHover(Math.min(xy.length - 1, Math.max(0, index)));
  }

  return (
    <div
      ref={box}
      className="relative"
      style={{ height }}
      onMouseMove={pick}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "var(--pane-up)" : "var(--pane-down)"} stopOpacity="0.28" />
            <stop offset="100%" stopColor={up ? "var(--pane-up)" : "var(--pane-down)"} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Ноль - опора взгляда: выше него счёт в плюсе, ниже в минусе. */}
        <line
          x1={PAD.left}
          y1={zeroY}
          x2={100 - PAD.right}
          y2={zeroY}
          stroke="var(--pane-border)"
          strokeWidth="0.4"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area} fill="url(#equity-fill)" />
        <path
          d={line}
          fill="none"
          stroke={up ? "var(--pane-up)" : "var(--pane-down)"}
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {current && (
          <>
            <line
              x1={current.x}
              y1={PAD.top}
              x2={current.x}
              y2={100 - PAD.bottom}
              stroke="var(--pane-muted)"
              strokeWidth="0.6"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={current.x}
              cy={current.y}
              r="2.4"
              fill={current.point.pnl >= 0 ? "var(--pane-up)" : "var(--pane-down)"}
              stroke="var(--pane-bg)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      {current && (
        // Подсказка идёт за курсором, но не вылезает за края: у правого края
        // она разворачивается влево.
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[132px] rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] px-2 py-1.5 text-[10px] shadow-lg"
          style={{
            left: `${current.x}%`,
            transform: current.x > 60 ? "translateX(-104%)" : "translateX(4%)",
          }}
        >
          <div className="font-semibold text-[var(--pane-text)]">
            {current.point.symbol.replace(/USDT$/, "")} · {day(current.point.at)}
          </div>
          <div className="mt-0.5 flex justify-between gap-3 text-[var(--pane-muted)]">
            <span>{labelResult}</span>
            <span
              className={`font-mono font-bold ${
                current.point.pnl >= 0 ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"
              }`}
            >
              {current.point.pnl >= 0 ? "+" : ""}
              {money(current.point.pnl)}
            </span>
          </div>
          <div className="flex justify-between gap-3 text-[var(--pane-muted)]">
            <span>{labelTrade}</span>
            <span className="font-mono font-bold text-[var(--pane-text)]">{money(current.point.value)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
