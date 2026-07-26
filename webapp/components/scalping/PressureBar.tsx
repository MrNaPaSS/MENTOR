"use client";

interface Props {
  label: string;
  /** Доля «покупок» от 0 до 1. */
  ratio: number;
  left: string;
  right: string;
  hint?: string;
}

/** Полоса перевеса: слева покупатели, справа продавцы. */
export default function PressureBar({ label, ratio, left, right, hint }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  return (
    <div className="rounded-xl border border-border/60 bg-bg-panel p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
        {hint && <span className="font-mono text-[11px] text-text-secondary">{hint}</span>}
      </div>

      <div className="flex h-2 overflow-hidden rounded-full bg-bg-deep">
        <div
          className="bg-success transition-[width] duration-300"
          style={{ width: `${pct}%` }}
          data-testid="pressure-fill"
        />
        <div className="flex-1 bg-danger transition-[width] duration-300" />
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[11px]">
        <span className="text-success">{left}</span>
        <span className="text-text-muted tabular-nums">{pct}%</span>
        <span className="text-danger">{right}</span>
      </div>
    </div>
  );
}
