"use client";

// Хватает ли окну ширины на две колонки.
//
// Тем же вопросом задаётся раскладка панели журнала: список сделок делится
// пополам только там, где половины действительно помещаются рядом. Одним CSS
// это не решается - делить нужно сами записи, а не место под ними, - поэтому
// ширину приходится спрашивать у браузера.

import { useEffect, useState } from "react";

/**
 * Следит за медиазапросом и отдаёт его ответ.
 *
 * До первого кадра в браузере - `false`: на сервере ширины нет, и угаданная
 * широкая раскладка схлопнулась бы на глазах у человека при гидрации.
 */
export function useMedia(query: string): boolean {
  const [yes, setYes] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setYes(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);

  return yes;
}
