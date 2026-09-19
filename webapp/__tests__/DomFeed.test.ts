/**
 * Кадр стакана мимо React.
 *
 * Кадр приходит восемь раз в секунду. Тот, кому нужен стакан, обязан видеть
 * каждый; тому, кто ведёт сделку, нужна цена, а не перерисовка; тому, кто
 * подписан на паспорт книги, - только смена инструмента. Три разные цены за
 * один и тот же кадр, и путать их нельзя.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  bookSnapshot,
  domSnapshot,
  forgetDom,
  publishDom,
  watchDom,
} from "@/lib/domFeed";
import type { DomFrame } from "@/lib/scalping";

function frame(over: Partial<DomFrame> = {}): DomFrame {
  return {
    symbol: "BTCUSDT",
    exchange: "binance",
    asked: "",
    fallback: "",
    mid: 76500,
    tick: 0.1,
    best_bid: 76499.9,
    best_ask: 76500.1,
    rows: [],
    wall: null,
    shelves: [],
    candle: null,
    foot: null,
    ...over,
  } as unknown as DomFrame;
}

beforeEach(() => forgetDom());

describe("кадр стакана", () => {
  it("снимок отдаёт последний кадр", () => {
    publishDom(frame({ mid: 100 }));
    expect(domSnapshot()?.mid).toBe(100);
    publishDom(frame({ mid: 101 }));
    expect(domSnapshot()?.mid).toBe(101);
  });

  it("подписчик слышит каждый кадр", () => {
    const seen: number[] = [];
    const off = watchDom((next) => seen.push(next?.mid ?? 0));
    publishDom(frame({ mid: 1 }));
    publishDom(frame({ mid: 2 }));
    publishDom(frame({ mid: 3 }));
    off();
    publishDom(frame({ mid: 4 }));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("паспорт книги не меняется от движения цены", () => {
    publishDom(frame({ mid: 100 }));
    const first = bookSnapshot();
    publishDom(frame({ mid: 101, best_bid: 100.9 }));
    // Та же ссылка: иначе график и меню шага перерисовывались бы восемь раз в
    // секунду ради чисел, которые не менялись.
    expect(bookSnapshot()).toBe(first);
  });

  it("паспорт книги меняется от смены инструмента, биржи и шага", () => {
    publishDom(frame());
    const first = bookSnapshot();

    publishDom(frame({ symbol: "ETHUSDT" }));
    expect(bookSnapshot()).not.toBe(first);
    expect(bookSnapshot()?.symbol).toBe("ETHUSDT");

    const second = bookSnapshot();
    publishDom(frame({ symbol: "ETHUSDT", tick: 0.01 }));
    expect(bookSnapshot()).not.toBe(second);
    expect(bookSnapshot()?.tick).toBe(0.01);

    const third = bookSnapshot();
    publishDom(frame({ symbol: "ETHUSDT", tick: 0.01, exchange: "okx" }));
    expect(bookSnapshot()).not.toBe(third);
    expect(bookSnapshot()?.exchange).toBe("okx");
  });

  it("книга уходит вместе с кадром: чужих цен на экране не остаётся", () => {
    publishDom(frame());
    forgetDom();
    expect(domSnapshot()).toBeNull();
    expect(bookSnapshot()).toBeNull();
  });
});
