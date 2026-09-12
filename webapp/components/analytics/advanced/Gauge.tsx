"use client";

// Кольцевой датчик: одна величина и то, насколько она хороша.
//
// Дуга неполная - от «совсем плохо» до «хорошо», а не от нуля до бесконечности:
// у винрейта потолок сто процентов, у профит-фактора смысла выше трёх уже нет,
// а просадка тем лучше, чем меньше. Поэтому каждый датчик получает свою шкалу
// готовой, а рисует одинаково.

export interface GaugeProps {
  /** Доля заполнения дуги, 0..1. */
  fill: number;
  label: string;
  value: string;
  /** Цвет дуги. */
  color: string;
  size?: number;
}

/** Дуга занимает три четверти круга: снизу остаётся место под подпись. */
const SWEEP = 0.75;

export default function Gauge({ fill, label, value, color, size = 92 }: GaugeProps) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circle = 2 * Math.PI * radius;
  const track = circle * SWEEP;
  const done = track * Math.min(1, Math.max(0, fill));

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(135deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--pane-hover)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${track} ${circle - track}`}
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
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-mono text-[17px] font-extrabold leading-none" style={{ color }}>
            {value}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-[var(--pane-muted)]">{label}</span>
    </div>
  );
}
