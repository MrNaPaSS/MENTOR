"use client";

// Вспышка молний при переходе в полный экран.
//
// Переход во весь экран - смена режима работы, а не просто больше пикселей:
// исчезает навигация, меняется расположение всего. Резкая смена без перехода
// читается как сбой отрисовки, поэтому между двумя состояниями стоит короткая
// вспышка - глаз успевает понять, что это сделал он сам.
//
// Живёт меньше секунды и снимает себя сама: анимация, которую нужно закрывать,
// перестаёт быть анимацией.

import { useEffect, useState } from "react";

/** Сколько живёт вспышка. Дольше - и она начинает мешать работе. */
const LIFETIME_MS = 620;

/**
 * Молнии от краёв к центру: по три с каждой стороны, ломаной линией.
 *
 * Координаты в процентах вьюпорта, чтобы не зависеть от размера экрана.
 */
const BOLTS: { path: string; delay: number }[] = [
  { path: "M 0 12 L 14 18 L 8 24 L 26 31", delay: 0 },
  { path: "M 0 50 L 16 47 L 10 55 L 30 52", delay: 60 },
  { path: "M 0 88 L 13 82 L 7 76 L 27 70", delay: 30 },
  { path: "M 100 14 L 86 20 L 92 26 L 74 33", delay: 40 },
  { path: "M 100 52 L 84 49 L 90 57 L 70 54", delay: 0 },
  { path: "M 100 86 L 87 80 L 93 74 L 73 68", delay: 80 },
  { path: "M 22 0 L 28 14 L 34 8 L 40 26", delay: 20 },
  { path: "M 62 0 L 68 16 L 74 10 L 80 28", delay: 70 },
  { path: "M 30 100 L 36 86 L 42 92 L 48 74", delay: 50 },
  { path: "M 70 100 L 76 84 L 82 90 L 88 72", delay: 10 },
];

export default function LightningFlash({ onDone }: { onDone: () => void }) {
  const [alive, setAlive] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => {
      setAlive(false);
      onDone();
    }, LIFETIME_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  if (!alive) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden motion-reduce:hidden">
      {/* Общее свечение: без него молнии выглядят наклейками поверх экрана. */}
      <div className="absolute inset-0 animate-flash-glow bg-accent-cyan/10" />
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {BOLTS.map((bolt) => (
          <path
            key={bolt.path}
            d={bolt.path}
            fill="none"
            stroke="#0AFFE0"
            strokeWidth={0.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-bolt"
            style={{ animationDelay: `${bolt.delay}ms` }}
          />
        ))}
      </svg>
    </div>
  );
}
