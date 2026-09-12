"use client";

// Тихая сноска в углу панели: откуда цифра и насколько она свежая.
//
// Бэкенд подписывает каждый рыночный ответ (`source` и `stale`). Пока данные
// живые и пришли с нашей биржи, сноски нет вовсе - подписывать нечего. Она
// появляется там, где ученик иначе не узнал бы: цена из другого места или
// последнее известное значение вместо живого.
//
// Мелкая и приглушённая намеренно. Это не ошибка и не предупреждение: паниковать
// не из-за чего, а знать стоит - на этих числах ученик считает позицию.

import { useT } from "@/lib/i18n";
import { originMark, sourceName, type Origin } from "@/lib/marketOrigin";

interface SourceMarkProps {
  origin: Origin | null | undefined;
  /** Источник, который для этой панели родной. По умолчанию наша биржа. */
  home?: string;
}

export default function SourceMark({ origin, home }: SourceMarkProps) {
  const t = useT();
  const mark = originMark(origin, home);
  if (!mark.show) return null;

  const name = sourceName(mark.source);
  const text = mark.mixed
    ? t.market.origin.mixed
    : mark.stale
      ? name
        ? t.market.origin.staleFrom(name)
        : t.market.origin.stale
      : t.market.origin.from(name);

  return (
    <span
      title={t.market.origin.title}
      className="whitespace-nowrap text-[10px] tracking-wide text-[var(--pane-muted)]"
    >
      {text}
    </span>
  );
}
