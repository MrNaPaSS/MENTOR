"use client";

// Активный символ приложения и привязка к нему панелей (ТЗ этап 5, §8.1).
//
// Панель либо следует за активным символом, либо прибита к своему. Так
// устроено рабочее место у OpenTerminal (поле `linked`), и приём здесь тот же,
// а устройство наше: состояние живёт вне React, как тема терминала и звук.
// Причина та же - панели разбросаны по разным ветвям дерева, а иногда и по
// разным страницам, и общий родитель для них выдумывать не за чем.
//
// Слушаем и своё событие, и `storage`: вторая вкладка терминала не должна
// разойтись с первой.

import { useEffect, useState } from "react";

const SYMBOL_KEY = "nmnh.symbol.active";
const LINKED_KEY = "nmnh.symbol.linked";
const SYMBOL_EVENT = "nmnh-active-symbol";
const LINKED_EVENT = "nmnh-symbol-linked";

/** Пара, с которой терминал открывается впервые. */
export const DEFAULT_SYMBOL = "BTCUSDT";

/** Как выглядит пара. Всё остальное - не пара, и подменять ею нечего. */
const SHAPE = /^[A-Z0-9]{2,20}$/;

/** Привести к общему виду или отказать. */
export function cleanSymbol(value: string | null | undefined): string | null {
  const symbol = (value ?? "").trim().toUpperCase();
  return SHAPE.test(symbol) ? symbol : null;
}

export function readActiveSymbol(): string {
  try {
    return cleanSymbol(localStorage.getItem(SYMBOL_KEY)) ?? DEFAULT_SYMBOL;
  } catch {
    // В приватном окне доступ к хранилищу бросает исключение.
    return DEFAULT_SYMBOL;
  }
}

/**
 * Сменить активный символ приложения.
 *
 * Мусор не проходит: неверно понятая пара - это не ошибка на экране, а чужая
 * цена, по которой ученик посчитает позицию.
 */
export function setActiveSymbol(value: string): void {
  const symbol = cleanSymbol(value);
  if (!symbol) return;
  try {
    localStorage.setItem(SYMBOL_KEY, symbol);
  } catch {
    // Не сохранилось - в этой вкладке символ всё равно сменится.
  }
  try {
    window.dispatchEvent(new CustomEvent(SYMBOL_EVENT, { detail: symbol }));
  } catch {
    // Окна нет - значит и подписчиков нет.
  }
}

function readLinks(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(LINKED_KEY) || "{}");
    return saved && typeof saved === "object" ? (saved as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/**
 * Привязана ли панель к активному символу.
 *
 * По умолчанию да: человек, открывший панель, ждёт в ней ту пару, которую
 * смотрит. Отвязывают её осознанно - чтобы держать вторую пару рядом.
 */
export function isLinked(panel: string): boolean {
  return readLinks()[panel] !== false;
}

export function setLinked(panel: string, linked: boolean): void {
  const links = { ...readLinks(), [panel]: linked };
  try {
    localStorage.setItem(LINKED_KEY, JSON.stringify(links));
  } catch {
    // См. выше: в этой вкладке привязка всё равно сменится.
  }
  try {
    window.dispatchEvent(new CustomEvent(LINKED_EVENT, { detail: { panel, linked } }));
  } catch {
    // Окна нет.
  }
}

/** Какую пару показывать панели: общую или её собственную. */
export function symbolFor(panel: string, own: string | null | undefined): string {
  if (isLinked(panel)) return readActiveSymbol();
  return cleanSymbol(own) ?? readActiveSymbol();
}

function subscribe(events: string[], fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SYMBOL_KEY || e.key === LINKED_KEY) fn();
  };
  events.forEach((name) => window.addEventListener(name, fn as EventListener));
  window.addEventListener("storage", onStorage);
  return () => {
    events.forEach((name) => window.removeEventListener(name, fn as EventListener));
    window.removeEventListener("storage", onStorage);
  };
}

/** Активный символ приложения с подпиской на смену. */
export function useActiveSymbol(): string {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);

  useEffect(() => {
    const read = () => setSymbol(readActiveSymbol());
    read();
    return subscribe([SYMBOL_EVENT], read);
  }, []);

  return symbol;
}

/**
 * Пара для панели и её привязка.
 *
 * `own` - пара, к которой панель прибита, когда привязка снята. Пусто -
 * показываем активную: панель без своей пары и без привязки показывала бы
 * пустоту.
 */
export function usePanelSymbol(
  panel: string,
  own?: string | null,
): { symbol: string; linked: boolean; setLinked: (linked: boolean) => void } {
  const [state, setState] = useState({ symbol: DEFAULT_SYMBOL, linked: true });

  useEffect(() => {
    const read = () =>
      setState({ symbol: symbolFor(panel, own), linked: isLinked(panel) });
    read();
    return subscribe([SYMBOL_EVENT, LINKED_EVENT], read);
  }, [panel, own]);

  return {
    ...state,
    setLinked: (linked: boolean) => setLinked(panel, linked),
  };
}
