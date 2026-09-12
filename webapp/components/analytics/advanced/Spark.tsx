"use client";

// Мини-график в плитке показателя: форма рядом с числом.
//
// Число без формы читается как приговор: «просадка 281 доллар» одинаково
// выглядит и когда её набрали одним днём, и когда она копилась месяц. Линия
// или столбики рядом отвечают на это раньше, чем человек откроет большой
// график.
//
// Рисуем в долях единицы через viewBox и растягиваем по месту:
// preserveAspectRatio="none" здесь уместен - искажать нечего, у линии нет
// кружков и подписей, а масштаб всё равно условный.

export type SparkKind = "line" | "bars";

export interface SparkProps {
  values: readonly number[];
  kind: SparkKind;
  /** Цвет линии и столбиков плюса. */
  color: string;
  /** Цвет столбиков минуса. Нет - минусы того же цвета. */
  down?: string;
  width?: number;
  height?: number;
}

/** Ширина зазора между столбиками, в долях шага. */
const GAP = 0.28;

export default function Spark({
  values,
  kind,
  color,
  down,
  width = 96,
  height = 34,
}: SparkProps) {
  if (values.length === 0) return <span style={{ width, height }} />;

  const top = Math.max(...values, 0);
  const bottom = Math.min(...values, 0);
  const span = top - bottom || 1;
  const y = (value: number) => 1 - (value - bottom) / span;

  if (kind === "line") {
    const step = values.length > 1 ? 1 / (values.length - 1) : 0;
    const line = values.map((value, i) => `${i === 0 ? "M" : "L"}${i * step} ${y(value)}`).join(" ");
    const area = `${line} L${(values.length - 1) * step} ${y(bottom)} L0 ${y(bottom)} Z`;
    const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

    return (
      <svg
        width={width}
        height={height}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden
        className="shrink-0"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="0.035"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ strokeWidth: 1.6 }}
        />
      </svg>
    );
  }

  const step = 1 / values.length;
  const zero = y(0);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden
      className="shrink-0"
    >
      {values.map((value, i) => {
        const up = value >= 0;
        const height = Math.max(0.02, Math.abs(y(value) - zero));
        return (
          <rect
            key={i}
            x={i * step + (step * GAP) / 2}
            y={up ? zero - height : zero}
            width={step * (1 - GAP)}
            height={height}
            fill={up ? color : (down ?? color)}
            opacity="0.85"
          />
        );
      })}
    </svg>
  );
}

/** Кольцо доли: винрейт в плитке показателя. */
export function SparkRing({
  fill,
  color,
  size = 34,
}: {
  /** Доля заполнения, 0..1. */
  fill: number;
  color: string;
  size?: number;
}) {
  const stroke = Math.max(3, Math.round(size / 8));
  const radius = (size - stroke) / 2;
  const circle = 2 * Math.PI * radius;
  const done = circle * Math.min(1, Math.max(0, fill));

  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--pane-hover)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${done} ${circle - done}`}
        className="transition-[stroke-dasharray] duration-700"
      />
    </svg>
  );
}
