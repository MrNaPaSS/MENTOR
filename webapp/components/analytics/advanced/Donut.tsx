"use client";

// Кольцо долей: из чего сложился итог и как сделки легли по дням.
//
// Кольцо, а не круг: середина занята главным числом, и человек читает сперва
// его, а доли - потом. Доли берём по модулю: минус на круговой диаграмме
// нарисовать нельзя, зато видно, какую часть оборота он занял.

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
}

/** Минимальный кусок дуги, чтобы доля в доли процента была видна. */
const MIN_SHARE = 0.006;

export default function Donut({ slices, size, thickness = 14, center }: DonutProps) {
  const radius = (size - thickness) / 2;
  const circle = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + Math.abs(slice.value), 0);

  let offset = 0;
  const arcs = slices.map((slice) => {
    const share = total > 0 ? Math.abs(slice.value) / total : 0;
    const drawn = share > 0 && share < MIN_SHARE ? MIN_SHARE : share;
    const arc = { ...slice, share, length: drawn * circle, offset };
    offset += drawn * circle;
    return arc;
  });

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--pane-hover)"
          strokeWidth={thickness}
        />
        {arcs.map((arc) =>
          arc.length > 0 ? (
            <circle
              key={arc.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={thickness}
              strokeDasharray={`${arc.length} ${circle - arc.length}`}
              strokeDashoffset={-arc.offset}
              strokeLinecap="butt"
              className="transition-[stroke-dasharray,stroke-dashoffset] duration-700"
            >
              <title>{`${arc.label} · ${Math.round(arc.share * 100)}%`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

/** Легенда кольца: точка цвета, подпись, значение и доля. */
export function DonutLegend({
  slices,
  showShare = true,
  className = "",
}: {
  slices: readonly Slice[];
  /** Показывать процент доли: у денег он лишний, у дней - главный. */
  showShare?: boolean;
  className?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.abs(slice.value), 0);

  return (
    <ul className={`min-w-0 space-y-1 ${className}`}>
      {slices.map((slice) => (
        <li key={slice.key} className="flex items-center gap-2 text-[11px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} />
          <span className="min-w-0 flex-1 truncate text-[var(--pane-text-2)]">{slice.label}</span>
          {slice.note && (
            <span
              className={`shrink-0 font-mono text-[11px] font-bold ${
                slice.tone === "up"
                  ? "text-[var(--pane-up)]"
                  : slice.tone === "down"
                    ? "text-[var(--pane-down)]"
                    : "text-[var(--pane-text)]"
              }`}
            >
              {slice.note}
            </span>
          )}
          {showShare && (
            <span className="w-9 shrink-0 text-right font-mono text-[10px] text-[var(--pane-muted)]">
              {total > 0 ? Math.round((Math.abs(slice.value) / total) * 100) : 0}%
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
