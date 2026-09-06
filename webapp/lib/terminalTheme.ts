"use client";

// Тема терминала за пределами самого терминала.
//
// Светлая тема включается в скальпинге, но белые панели на чёрной странице
// выглядят вырезанными из другого приложения: шапка, навигация и фон вокруг
// обязаны светлеть вместе с ними. Страница и оболочка сайта - разные ветки
// дерева, поэтому тема живёт в одном месте снаружи от обеих.
//
// Хранится в том же ключе, что и остальное рабочее место: тема - его часть, и
// после перезахода оболочка должна открыться такой же, какой её оставили.

import { useEffect, useState } from "react";

export type TerminalTheme = "dark" | "light";

const KEY = "nmnh.scalping.theme";
const EVENT = "nmnh-terminal-theme";

export function readTerminalTheme(): TerminalTheme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
    return "dark";
  }
}

/** Запомнить тему и сказать об этом всем, кто её слушает. */
export function setTerminalTheme(theme: TerminalTheme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Не сохранилось - в этой вкладке тема всё равно применится.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

/**
 * Тема терминала с подпиской на её смену.
 *
 * Слушаем и своё событие, и storage: во второй вкладке терминала тема тоже
 * может смениться, и оболочка не должна остаться в прежней.
 */
export function useTerminalTheme(): TerminalTheme {
  const [theme, setTheme] = useState<TerminalTheme>("dark");

  useEffect(() => {
    setTheme(readTerminalTheme());

    function onLocal(event: Event) {
      const next = (event as CustomEvent<TerminalTheme>).detail;
      setTheme(next === "light" ? "light" : "dark");
    }
    function onStorage(event: StorageEvent) {
      if (event.key === KEY) setTheme(readTerminalTheme());
    }

    window.addEventListener(EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return theme;
}
