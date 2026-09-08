import { describe, it, expect } from "vitest";

import { price, STAMP_BOX } from "@/lib/pnl/card";
import { cardFromTrade, roiOf } from "@/lib/pnl/data";
import type { JournalTrade } from "@/lib/journal";

// Карточку отправляют в чат, и там её сверяют с приложением биржи. Ошибка в
// этих числах - это не кривая картинка, а обещание дохода, которого не было.

function trade(over: Partial<JournalTrade> = {}): JournalTrade {
  return {
    id: 1,
    client_id: "c1",
    symbol: "ENAUSDT",
    side: "long",
    entry: 0.1635,
    stop: 0.16,
    exit_price: 0.17665,
    qty: 1000,
    margin: 100,
    leverage: 25,
    takes_hit: 3,
    fee: 1.2,
    targets: [0.17, 0.175, 0.18],
    outcome: "take",
    pnl: 201.02,
    opened_at: "2026-09-06T20:00:00Z",
    closed_at: "2026-09-06T23:47:12Z",
    note: "",
    ...over,
  };
}

describe("доход карточки", () => {
  it("считается от залога, а не от оборота", () => {
    // Так его считают биржи: плечо превращает движение цены в проценты на
    // залог, и меньшая цифра выглядела бы обманом в обратную сторону.
    expect(roiOf(trade({ pnl: 201.02, margin: 100 }))).toBeCloseTo(201.02, 6);
    expect(roiOf(trade({ pnl: -64.18, margin: 100 }))).toBeCloseTo(-64.18, 6);
    expect(roiOf(trade({ pnl: 50, margin: 200 }))).toBeCloseTo(25, 6);
  });

  it("залога нет - процентов тоже, а не бесконечность", () => {
    expect(roiOf(trade({ margin: 0 }))).toBe(0);
    expect(roiOf(trade({ margin: -5 }))).toBe(0);
  });

  it("итог берётся после комиссии - тот, что пришёл на счёт", () => {
    const card = cardFromTrade(trade({ pnl: 98.71, fee: 32.08 }));
    expect(card.pnl).toBe(98.71);
  });

  it("незакрытая сделка оставляет цену выхода пустой", () => {
    expect(cardFromTrade(trade({ exit_price: null })).exit).toBeNull();
  });

  it("имя владельца необязательно", () => {
    expect(cardFromTrade(trade()).owner).toBeUndefined();
    expect(cardFromTrade(trade(), "kaktotakxm").owner).toBe("kaktotakxm");
  });
});

describe("цена на карточке", () => {
  it("точность по величине - как её показывают биржи", () => {
    // Показать 0,16 там, где на бирже 0,16350, значит разойтись с приложением,
    // по которому трейдер и сверяет карточку.
    expect(price(0.1635)).toBe("0,16350");
    expect(price(79154.6)).toBe("79154,60");
    expect(price(1.2345678)).toBe("1,2346");
    expect(price(0.00001234)).toBe("0,00001234");
  });

  it("нечего показывать - прочерк, а не ноль", () => {
    expect(price(0)).toBe("-");
    expect(price(Number.NaN)).toBe("-");
  });
});

describe("место под печать", () => {
  it("совпадает с рамкой на заготовке", () => {
    // Рамка нарисована на самой картинке: 20..391 по горизонтали и 23..112 по
    // вертикали при размере 640x852. Разъедутся доли - печать съедет с рамки.
    expect(STAMP_BOX.x * 640).toBeCloseTo(20, 6);
    expect(STAMP_BOX.y * 852).toBeCloseTo(23, 6);
    expect((STAMP_BOX.x + STAMP_BOX.w) * 640).toBeCloseTo(391, 6);
    expect((STAMP_BOX.y + STAMP_BOX.h) * 852).toBeCloseTo(112, 6);
  });
});
