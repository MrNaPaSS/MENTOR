"use client";

// Горы над шапкой раздела - в самой верхней панели кабинета.
//
// Панель закреплена поверх страницы, и горы, нарисованные в шапке раздела,
// уходили под неё: вершина пряталась. Здесь они живут внутри панели, за её
// кнопками, и спускаются из неё к девизу и короне шапки раздела. Место под
// них в строке шапки держит пустой блок в PaneHead, поэтому кнопки раздела
// на горы не встают.
//
// Страница под панелью прокручивается, а панель - нет: стоило бы горам
// остаться, они висели бы над карточками. Поэтому при прокрутке они тают.

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { useTerminalTheme } from "@/lib/terminalTheme";

/** Разделы со шапкой, где справа девиз и корона: горы нужны только им. */
const ROUTES = ["/app/analysis", "/app/analytics", "/app/market", "/app/news", "/app/profile", "/app/shop"];

/** Сколько прокрутить, чтобы горы спрятались. */
const HIDE_AFTER = 24;

const MASK =
  "linear-gradient(to bottom, #000 45%, transparent 94%), linear-gradient(to right, transparent, #000 40%)";

export default function HeadArt({ pathname }: { pathname: string }) {
  const theme = useTerminalTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > HIDE_AFTER);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return null;

  return (
    <img
      src="/art/brand/mountains.webp"
      alt=""
      aria-hidden
      // Правый край - там, где в шапке раздела кончается место под горы:
      // отступ кабинета, корона и девиз.
      className="pointer-events-none absolute right-[172px] top-2 hidden h-[128px] w-auto transition-opacity duration-300 ease-out xl:block"
      style={{
        opacity: scrolled ? 0 : theme === "light" ? 0.5 : 0.32,
        filter: "saturate(0.6)",
        maskImage: MASK,
        maskComposite: "intersect",
        WebkitMaskImage: MASK,
        WebkitMaskComposite: "source-in",
      }}
    />
  );
}
