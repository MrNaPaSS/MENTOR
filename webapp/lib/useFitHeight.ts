"use client";

// Высота, на которой раздел кончается ровно внизу окна.
//
// Считается от места самого блока, а не долей экрана: над ним лента котировок,
// верхняя панель и шапка раздела, и их высота меняется. Под ним - нижнее поле
// кабинета, которое видно только в стилях. Без этих поправок у страницы
// оставался хвост прокрутки ровно в эти отступы.

import { useEffect, useRef, useState } from "react";

export interface Fit {
  ref: React.RefObject<HTMLDivElement>;
  /** Сколько высоты остаётся блоку до низа окна. */
  height: number;
  /** Высота шапки первой панели внутри блока: её меряют, а не берут числом. */
  head: number;
  /** Широкий экран: на узком раздел живёт своей высотой и прокручивается. */
  wide: boolean;
}

/** `min` - ниже этого не ужимаем: раздел перестал бы читаться. */
export function useFitHeight(min: number, wideAt = 1280): Fit {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(min);
  const [head, setHead] = useState(0);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const main = el.closest("main");
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      setHeight(Math.max(min, Math.round(window.innerHeight - top - pad)));
      setHead(el.querySelector("header")?.getBoundingClientRect().height ?? 0);
      setWide(window.innerWidth >= wideAt);
    };

    measure();
    // Ещё раз в следующем кадре: разметка после первого прохода часто доезжает.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [min, wideAt]);

  return { ref, height, head, wide };
}
