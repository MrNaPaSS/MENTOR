"use client";

// Горы над шапкой раздела: вершина - на верхней панели кабинета, основание -
// в самой странице, под кнопками раздела.
//
// Один рисунок, два слоя. Панель закреплена поверх страницы, и гора, целиком
// нарисованная в странице, пряталась под неё вершиной; целиком нарисованная
// в панели - ложилась поверх кнопок раздела. Поэтому в панели гора обрезана
// по её краю и стоит за кнопками панели (HeadArt), а в странице тот же рисунок
// в том же месте стоит за кнопками и карточками (PageRidge). Слои совмещены
// по экрану, и глаз видит одну гору.
//
// Страница под панелью прокручивается, а панель - нет: слои разъехались бы.
// Поэтому при прокрутке гора тает.

/* eslint-disable @next/next/no-img-element */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTerminalTheme } from "@/lib/terminalTheme";

/** Разделы со шапкой, где справа девиз и корона: горы нужны только им. */
const ROUTES = ["/app/analysis", "/app/analytics", "/app/market", "/app/profile", "/app/shop"];

/** Сколько прокрутить, чтобы гора спряталась. */
const HIDE_AFTER = 24;

/** Где гора на экране: от верха верхней панели и от правого края окна. */
const TOP_IN_HEADER = 8;
const RIGHT = 172;
const HEIGHT = 128;

const MASK =
  "linear-gradient(to bottom, #000 45%, transparent 94%), linear-gradient(to right, transparent, #000 40%)";

function useRidgeOpacity(): number {
  const theme = useTerminalTheme();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > HIDE_AFTER);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (scrolled) return 0;
  return theme === "light" ? 0.5 : 0.32;
}

function Ridge({ top, right, opacity }: { top: number; right: number; opacity: number }) {
  return (
    <img
      src="/art/brand/mountains.webp"
      alt=""
      aria-hidden
      className="pointer-events-none absolute w-auto max-w-none transition-opacity duration-300 ease-out"
      style={{
        top,
        right,
        height: HEIGHT,
        opacity,
        filter: "saturate(0.6)",
        maskImage: MASK,
        maskComposite: "intersect",
        WebkitMaskImage: MASK,
        WebkitMaskComposite: "source-in",
      }}
    />
  );
}

/** Вершина - в верхней панели, обрезана по её краю, за её кнопками. */
export default function HeadArt({ pathname }: { pathname: string }) {
  const opacity = useRidgeOpacity();
  if (!ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return null;
  return (
    // С lg, а не с xl: планшет в горизонтали (1024-1279) раньше оставался без гор
    // на всех разделах, хотя места под них в шапке хватает.
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block">
      <Ridge top={TOP_IN_HEADER} right={RIGHT} opacity={opacity} />
    </div>
  );
}

/**
 * Основание - в шапке раздела, под её кнопками и под карточками.
 *
 * Место считается от настоящей верхней панели: высота ленты котировок над
 * ней может меняться, и числом наугад слои бы разошлись.
 */
export function PageRidge() {
  const opacity = useRidgeOpacity();
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Считаем место не один раз при загрузке, а на каждое движение того, от чего
  // оно зависит.
  //
  // Верхняя панель встаёт на своё место не сразу: над ней лента котировок, её
  // высота приходит с первыми ценами, а ширину текста меняет загрузка шрифтов.
  // Замер до этого давал верную цифру для той секунды и неверную для
  // следующей: слои расходились, и гора в странице оказывалась ниже и левее
  // своей вершины в панели. Со стороны это и есть «после перезагрузки горы
  // сместились».
  useLayoutEffect(() => {
    const measure = () => {
      const header = document.querySelector("header");
      const box = anchor.current?.parentElement;
      if (!header || !box) return;
      const h = header.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      // Панель закреплена, страница - нет: считаем как при нулевой прокрутке.
      const top = Math.round(h.top + TOP_IN_HEADER - (b.top + window.scrollY));
      const right = Math.round(RIGHT - (document.documentElement.clientWidth - b.right));
      setPos((was) => (was && was.top === top && was.right === right ? was : { top, right }));
    };

    measure();
    // Ещё раз в следующем кадре: разметка после первого прохода часто ещё
    // доезжает, а лишний замер стоит доли миллисекунды.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    // Картинки ленты и шапки догружаются после первой отрисовки.
    window.addEventListener("load", measure);
    // Шрифт меняет высоту строк, а с ней и место панели.
    document.fonts?.ready?.then(measure).catch(() => {});

    // Лента котировок и сама шапка меняют высоту и без изменения размера окна:
    // пришли новые цены, свернулось уведомление. Событие resize на это не
    // приходит, поэтому смотрим за самими коробками.
    const header = document.querySelector("header");
    const box = anchor.current?.parentElement;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (observer) {
      if (header) observer.observe(header);
      if (box) observer.observe(box);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("load", measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <span ref={anchor} aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden lg:block">
      {pos && <Ridge top={pos.top} right={pos.right} opacity={opacity} />}
    </span>
  );
}
