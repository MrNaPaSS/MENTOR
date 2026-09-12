"use client";

// Кривая капитала: как рос счёт от сделки к сделке.
//
// Рисуем сами, а не библиотекой: линия здесь одна, зато нужна подсказка о
// конкретной сделке под курсором, а чужой график ради этого тянет свой пакет
// и свою тему.
//
// Координаты считаем в настоящих точках экрана, а не в долях: растянутая
// система координат искажает всё, что в ней нарисовано - кружок отметки
// превращался в эллипс, а линия сетки меняла толщину от ширины панели.
//
// Точки равномерны по номеру сделки, а не по времени: между сделками бывают
// недели, и на шкале времени активная неделя сжималась бы в точку.

import { useEffect, useMemo, useRef, useState } from "react";
import type { EquityPoint } from "@/lib/analytics/advanced";

/** Поля: слева под подписи сумм, снизу под даты. */
const PAD = { top: 10, right: 10, bottom: 18, left: 48 };
/** Сколько горизонтальных линий сетки рисуем. */
const LINES = 4;

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
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  // Ширину меряем: она зависит от колонки, а колонка - от окна.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    watch?.observe(el);
    return () => watch?.disconnect();
  }, []);

  const view = useMemo(() => {
    if (points.length === 0 || width === 0) return null;
    const values = points.map((p) => p.value);
    // Ноль всегда в поле зрения: без него растущая кривая висит в воздухе, и
    // не видно, что счёт вообще в плюсе.
    const top = Math.max(0, ...values);
    const bottom = Math.min(0, ...values);
    const span = top - bottom || 1;

    const innerW = Math.max(1, width - PAD.left - PAD.right);
    const innerH = Math.max(1, height - PAD.top - PAD.bottom);
    const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    const y = (value: number) => PAD.top + ((top - value) / span) * innerH;

    const xy = points.map((point, i) => ({
      x: PAD.left + stepX * i,
      y: y(point.value),
      point,
    }));

    const grid = Array.from({ length: LINES + 1 }, (_, i) => {
      const value = top - (span / LINES) * i;
      return { value, y: y(value) };
    });

    return { xy, grid, zeroY: y(0), innerW };
  }, [points, width, height]);

  if (points.length === 0) {
    return (
      <div
        ref={box}
        className="grid place-items-center text-[11px] text-[var(--pane-muted)]"
        style={{ height }}
      >
        {empty}
      </div>
    );
  }

  const current = hover !== null && view ? view.xy[hover] : null;
  const last = points[points.length - 1].value;
  const up = last >= 0;
  const stroke = up ? "var(--pane-up)" : "var(--pane-down)";

  function pick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !view) return;
    const x = event.clientX - rect.left;
    const share = (x - PAD.left) / view.innerW;
    const index = Math.round(share * (view.xy.length - 1));
    setHover(Math.min(view.xy.length - 1, Math.max(0, index)));
  }

  return (
    <div
      ref={box}
      className="relative select-none"
      style={{ height }}
      onMouseMove={pick}
      onMouseLeave={() => setHover(null)}
    >
      {view && (
        <svg width={width} height={height} className="block" aria-hidden>
          <defs>
            <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Сетка с подписями сумм: без них высота кривой ничего не значит. */}
          {view.grid.map((line) => (
            <g key={line.value}>
              <line
                x1={PAD.left}
                y1={line.y}
                x2={width - PAD.right}
                y2={line.y}
                stroke="var(--pane-border)"
                strokeWidth="1"
                strokeDasharray={Math.abs(line.value) < 1e-9 ? undefined : "3 4"}
                opacity={Math.abs(line.value) < 1e-9 ? 0.9 : 0.45}
              />
              <text
                x={PAD.left - 6}
                y={line.y + 3}
                textAnchor="end"
                className="fill-[var(--pane-muted)] font-mono"
                style={{ fontSize: 9 }}
              >
                {money(line.value)}
              </text>
            </g>
          ))}

          <path
            d={`${view.xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ")} L${
              view.xy[view.xy.length - 1].x
            } ${view.zeroY} L${view.xy[0].x} ${view.zeroY} Z`}
            fill="url(#equity-fill)"
          />
          <path
            d={view.xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Крайние даты: когда период начался и кончился. */}
          <text
            x={PAD.left}
            y={height - 4}
            className="fill-[var(--pane-muted)] font-mono"
            style={{ fontSize: 9 }}
          >
            {day(points[0].at)}
          </text>
          <text
            x={width - PAD.right}
            y={height - 4}
            textAnchor="end"
            className="fill-[var(--pane-muted)] font-mono"
            style={{ fontSize: 9 }}
          >
            {day(points[points.length - 1].at)}
          </text>

          {current && (
            <>
              <line
                x1={current.x}
                y1={PAD.top}
                x2={current.x}
                y2={height - PAD.bottom}
                stroke="var(--pane-muted)"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.7"
              />
              <circle
                cx={current.x}
                cy={current.y}
                r="6"
                fill={current.point.pnl >= 0 ? "var(--pane-up)" : "var(--pane-down)"}
                opacity="0.18"
              />
              <circle
                cx={current.x}
                cy={current.y}
                r="3.5"
                fill={current.point.pnl >= 0 ? "var(--pane-up)" : "var(--pane-down)"}
                stroke="var(--pane-bg)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
      )}

      {current && (
        // Подсказка держится у отметки и не вылезает за края: у правого края
        // разворачивается влево.
        <div
          className="pointer-events-none absolute z-10 min-w-[140px] rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] px-2.5 py-2 shadow-lg"
          style={{
            left: current.x,
            top: Math.max(4, current.y - 74),
            transform: current.x > width * 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <div className="text-[11px] font-bold text-[var(--pane-text)]">
            {current.point.symbol.replace(/USDT$/, "")}
            <span className="ml-1.5 text-[10px] font-medium text-[var(--pane-muted)]">
              {day(current.point.at)}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-4 text-[10px] text-[var(--pane-muted)]">
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
          <div className="flex justify-between gap-4 text-[10px] text-[var(--pane-muted)]">
            <span>{labelTrade}</span>
            <span className="font-mono font-bold text-[var(--pane-text)]">
              {money(current.point.value)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
