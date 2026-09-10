"use client";

// Число, которое докручивается до нового значения, а не подменяется.
//
// Нужно в одном месте - счётчике монет в шапке после получения награды:
// монеты долетают, число бежит вверх, и видно, сколько прибавилось. Покупка
// уменьшает баланс - там число меняется сразу: трата не праздник.

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./coinFlight";

/** Та же кривая, что у счётчиков витрины (components/ui/Counter): easeOutExpo. */
function easeOutExpo(p: number): number {
  return p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
}

export function useRollingNumber(value: number | null, duration = 900): number | null {
  const [shown, setShown] = useState<number | null>(value);
  // Откуда крутить: то, что на экране сейчас, а не прошлая цель. Если число
  // сменилось посреди прокрутки, бег продолжается с места, а не скачет.
  const current = useRef<number | null>(value);

  useEffect(() => {
    const from = current.current;
    if (value === null || from === null || value <= from || prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const next = Math.round(from + (value - from) * easeOutExpo(p));
      current.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
}
