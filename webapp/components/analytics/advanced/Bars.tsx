"use client";

// Столбики одного ряда: распределение по риску, дни недели, часы.
//
// Один компонент на три графика: у них общее поведение - нулевая линия
// посередине, высота от самого крупного значения, подсказка по наведению.
// Разные только подписи, и они приходят готовыми.

export interface BarItem {
  key: string;
  /** Подпись под столбиком. Пусто - подписи нет, но место под неё есть. */
  label: string;
  value: number;
  /** Что показать в подсказке помимо значения: например, число сделок. */
  note?: string;
  /** Выбран ли столбик: по нему отфильтрован раздел. */
  active?: boolean;
}

export default function Bars({
  items,
  height,
  format,
  onPick,
}: {
  items: readonly BarItem[];
  height: number;
  /** Значение словами - для подсказки. */
  format: (value: number) => string;
  /** Нажатие по столбику: им фильтруют раздел. Нет - столбики не нажимаются. */
  onPick?: (key: string) => void;
}) {
  const peak = Math.max(1, ...items.map((item) => Math.abs(item.value)));
  // Если минусов нет вовсе, нулевая линия уходит вниз: половина поля под
  // пустоту - это график, у которого отняли половину высоты.
  const hasLoss = items.some((item) => item.value < 0);
  const zero = hasLoss ? 0.5 : 1;

  return (
    // Нулевая линия: без неё столбики висят, и не видно, где плюс сменился
    // минусом - а это единственное, ради чего на такой график смотрят.
    <div className="relative flex items-end gap-1" style={{ height }}>
      <span
        className="pointer-events-none absolute inset-x-0 border-t border-[var(--pane-border)]"
        style={{ top: (height - 16) * zero }}
      />
      {items.map((item) => {
        const share = Math.abs(item.value) / peak;
        const up = item.value >= 0;
        const color = up ? "var(--pane-up)" : "var(--pane-down)";
        const bar = Math.max(item.value === 0 ? 1 : 2, share * (height - 16) * zero);

        const body = (
          <>
            <span
              className="flex w-full flex-col justify-end"
              style={{ height: (height - 16) * zero }}
            >
              {up && (
                <span
                  className="w-full rounded-t transition-[height,opacity] duration-300"
                  style={{ height: bar, background: color, opacity: item.active ? 1 : 0.72 }}
                />
              )}
            </span>
            {hasLoss && (
              <span className="flex w-full flex-col" style={{ height: (height - 16) * 0.5 }}>
                {!up && (
                  <span
                    className="w-full rounded-b transition-[height,opacity] duration-300"
                    style={{ height: bar, background: color, opacity: item.active ? 1 : 0.72 }}
                  />
                )}
              </span>
            )}
            <span className="mt-0.5 block truncate text-[8px] text-[var(--pane-muted)]">
              {item.label}
            </span>
          </>
        );

        const title = `${item.label}: ${format(item.value)}${item.note ? ` · ${item.note}` : ""}`;

        return onPick ? (
          <button
            key={item.key}
            type="button"
            onClick={() => onPick(item.key)}
            title={title}
            className="flex min-w-0 flex-1 flex-col items-center rounded transition-colors hover:bg-[var(--pane-hover)]"
          >
            {body}
          </button>
        ) : (
          <div
            key={item.key}
            title={title}
            className="flex min-w-0 flex-1 cursor-default flex-col items-center rounded transition-colors hover:bg-[var(--pane-hover)]"
          >
            {body}
          </div>
        );
      })}
    </div>
  );
}
