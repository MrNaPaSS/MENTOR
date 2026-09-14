"use client";

// Знак биржи картинкой, а если файла ещё нет - её имя тем же цветом.
//
// Биржа подключается кодом, а знак кладут руками, и ждать картинку значит
// держать подключённую биржу невидимой. Поэтому запасной вид здесь не
// украшение, а рабочее состояние: появится `webp` - подхватится сам, без
// правки кода. Пути и цвета лежат в одном реестре (`lib/venueMarks.ts`),
// чтобы главная, профиль и витрина показывали биржу одинаково.

import { useState } from "react";

import { venueMark } from "@/lib/venueMarks";

export default function VenueMark({
  code,
  name,
  className = "",
  nameClassName = "",
  decorative = false,
}: {
  code: string;
  name: string;
  /** Размеры знака: у каждого места они свои. */
  className?: string;
  /** Как выглядит имя биржи, когда знака нет. */
  nameClassName?: string;
  /** Знак стоит рядом с названием - читать его вслух второй раз незачем. */
  decorative?: boolean;
}) {
  const mark = venueMark(code);
  const [missing, setMissing] = useState(false);

  // Биржи нет в реестре знаков - рисовать нечем и цвета её мы не знаем.
  // Место под знак тогда не занимаем: пустой прямоугольник хуже, чем его
  // отсутствие.
  if (!mark) return null;

  if (missing) {
    return (
      <span
        className={`flex items-center font-black tracking-tight ${className} ${nameClassName}`}
        style={{ color: mark.tint }}
      >
        {name}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mark.src}
      alt={decorative ? "" : name}
      aria-hidden={decorative || undefined}
      loading="lazy"
      decoding="async"
      onError={() => setMissing(true)}
      className={`object-contain ${mark.glow} ${className}`}
    />
  );
}
