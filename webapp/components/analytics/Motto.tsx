// Девиз у картинки раздела: несколько коротких строк заглавными с разрядкой,
// как подпись на плакате. Цвет приглушённый - это оформление, а не данные.

/** Девиз бренда. Не переводится: это имя, а не фраза интерфейса. */
export const BRAND_MOTTO = ["Discipline", "creates", "freedom"] as const;

export default function Motto({
  lines,
  className = "",
}: {
  lines: readonly string[];
  className?: string;
}) {
  return (
    <p
      aria-hidden
      className={`select-none text-[9px] font-semibold uppercase leading-[1.8] tracking-[0.32em] text-[var(--pane-muted)] ${className}`}
    >
      {lines.map((line) => (
        <span key={line} className="block whitespace-nowrap">
          {line}
        </span>
      ))}
    </p>
  );
}
