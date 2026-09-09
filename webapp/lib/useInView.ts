"use client";

// Дошли ли до элемента глазами.
//
// Нужно там, где содержимое дорогое: чужие виджеты тянут свой скрипт, свой
// кадр и свои запросы, и четыре таких на странице соревнуются за канал в тот
// самый момент, когда человек смотрит на первый. Отложенные до появления на
// экране, они не мешают друг другу и не грузятся вовсе, если до них так и не
// долистали.
//
// Возвращает признак один раз и больше не гасит его: спрятать уже собранный
// виджет значит собрать его заново при следующем взгляде.

import { useEffect, useState, type RefObject } from "react";

/**
 * Запас до края экрана, за которым содержимое начинает собираться.
 *
 * Полэкрана: к моменту, когда до виджета долистают, он уже готов, а грузиться
 * начинает не раньше, чем в нём появится смысл.
 */
const AHEAD = "50% 0px";

export function useInView(ref: RefObject<Element | null>, ahead: string = AHEAD): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const node = ref.current;
    if (!node) return;

    // Браузер без наблюдателя показывает всё сразу: лучше лишняя загрузка, чем
    // пустое место там, где должен быть виджет.
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }

    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((one) => one.isIntersecting)) {
          setSeen(true);
          watch.disconnect();
        }
      },
      { rootMargin: ahead },
    );
    watch.observe(node);
    return () => watch.disconnect();
  }, [ref, ahead, seen]);

  return seen;
}
