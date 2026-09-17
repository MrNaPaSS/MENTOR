"use client";

// Карточка итога: подпись и число.
//
// Живёт отдельно, потому что показывают её обе вкладки журнала - и список, и
// разбор. Разные рамки вокруг одних и тех же цифр читались бы как разные
// цифры.

export interface StatProps {
  label: string;
  value: string;
  /** Класс цвета: плюс зелёный, минус красный. Пусто - обычный текст. */
  tone?: string;
}

export default function Stat({ label, value, tone }: StatProps) {
  return (
    <div className="rounded border border-[var(--pane-border)] px-2 py-1">
      <div className="text-[10px] text-[var(--pane-muted)]">{label}</div>
      <div className={tone ?? "text-[var(--pane-text)]"}>{value}</div>
    </div>
  );
}
