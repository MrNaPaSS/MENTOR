"use client";

// Кадр стакана - мимо страницы, прямо тем, кому он нужен.
//
// Сервер шлёт кадр восемь раз в секунду. Пока кадр лежал в состоянии страницы
// терминала, каждый из них перерисовывал её целиком - а это четыре с лишним
// тысячи строк разметки, шесть десятков состояний, график, журнал, чат,
// диалоги. Стакану же нужен только стакан.
//
// Поэтому кадр живёт здесь, а не в React. Желающие берут его тремя способами,
// и выбор способа - это и есть выбор цены:
//
//   useDomFrame()   - кадр с перерисовкой. Для стакана и графика: они обязаны
//                     меняться восемь раз в секунду, за этим их и смотрят.
//   useBookInfo()   - паспорт книги: монета, биржа, шаг цены. Меняется при
//                     смене инструмента, то есть раз в несколько минут.
//   watchDom(fn)    - подписка без перерисовки. Для ведения сделки: логике
//                     нужна свежая цена, а не свежая картинка.
//   useLivePrice()  - цена середины, три раза в секунду. Для того, что должно
//                     быть живым, но не обязано идти нога в ногу с книгой.
//
// Снимок для обработчиков - domSnapshot(): в миг нажатия нужна цена, которая
// на экране сейчас, а держать её ради этого в состоянии незачем.

import { useEffect, useState, useSyncExternalStore } from "react";

import type { DomFrame } from "./scalping";

/**
 * Как часто отдавать цену тем, кому хватит трёх раз в секунду.
 *
 * Ярлык позиции и итог сделки от этого не станут менее живыми, а шкала цен
 * графика пересчитывается на каждом новом числе - и делать это восемь раз в
 * секунду незачем.
 */
const PRICE_EVERY_MS = 330;

/** Паспорт открытой книги: то в кадре, что меняется со сменой инструмента. */
export interface BookInfo {
  /** Монета книги - не та, что просили, а та, что пришла. */
  symbol: string;
  /** Биржа книги. */
  exchange: string;
  /** Какую биржу просил клиент. Пусто - не просил. */
  asked: string;
  /** Почему книга не с той биржи: "no_symbol", "no_feed" или пусто. */
  fallback: string;
  /** Шаг цены биржи. */
  tick: number;
}

let frame: DomFrame | null = null;
let book: BookInfo | null = null;
const watchers = new Set<(next: DomFrame | null) => void>();

/** Тот же ли паспорт книги. */
function sameBook(a: BookInfo | null, b: BookInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.symbol === b.symbol &&
    a.exchange === b.exchange &&
    a.asked === b.asked &&
    a.fallback === b.fallback &&
    a.tick === b.tick
  );
}

function bookOf(next: DomFrame | null): BookInfo | null {
  if (!next) return null;
  return {
    symbol: next.symbol,
    exchange: next.exchange,
    asked: next.asked,
    fallback: next.fallback,
    tick: next.tick,
  };
}

/**
 * Положить кадр. Зовёт живой канал и никто больше.
 *
 * Паспорт книги пересобирается только когда в нём что-то поменялось: иначе
 * подписчики на него просыпались бы вместе со всеми - по ссылке новый объект
 * отличается от прежнего, даже если числа в нём те же.
 */
export function publishDom(next: DomFrame | null): void {
  frame = next;
  const nextBook = bookOf(next);
  if (!sameBook(book, nextBook)) book = nextBook;
  for (const watcher of watchers) watcher(next);
}

/** Кадр, пришедший последним. Для обработчиков: нажали - берём цену. */
export function domSnapshot(): DomFrame | null {
  return frame;
}

/** Паспорт открытой книги без перерисовки. */
export function bookSnapshot(): BookInfo | null {
  return book;
}

/** Подписка без перерисовки: кадр приходит в функцию. */
export function watchDom(fn: (next: DomFrame | null) => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

function subscribe(fn: () => void): () => void {
  return watchDom(fn);
}

/** На сервере кадра нет и быть не может: стакан живёт в браузере. */
function noFrame(): DomFrame | null {
  return null;
}

function noBook(): BookInfo | null {
  return null;
}

/** Кадр целиком, с перерисовкой на каждом. Для стакана и графика. */
export function useDomFrame(): DomFrame | null {
  return useSyncExternalStore(subscribe, domSnapshot, noFrame);
}

/** Паспорт книги: перерисовка только при смене инструмента или биржи. */
export function useBookInfo(): BookInfo | null {
  return useSyncExternalStore(subscribe, bookSnapshot, noBook);
}

/** Забыть кадр: уходим со страницы терминала. */
export function forgetDom(): void {
  publishDom(null);
}

/** Цена середины книги, не чаще трёх раз в секунду. */
export function useLivePrice(): number {
  const [price, setPrice] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const mid = domSnapshot()?.mid ?? 0;
      setPrice((current) => (current === mid ? current : mid));
    }, PRICE_EVERY_MS);
    return () => clearInterval(id);
  }, []);

  return price;
}
