/**
 * Карточка сделки, отправленной в чат.
 *
 * Карточка живёт в чужой ленте часами: плавающий результат к тому времени уже
 * неправда, а взятые целями деньги - взяты. Поэтому у идущей сделки крупным
 * стоит забранное, рядом видно, сколько целей отработало, а стоп за входом
 * подписан «б/у», а не ценой: цифра сама по себе не говорит, что сделка уже
 * не может кончиться убытком.
 */

import { describe, it, expect } from "vitest";

import { breakeven, cardFromShared } from "@/lib/pnl/data";
import type { SharedTrade } from "@/lib/chat/api";

const AT = "2026-09-17T16:28:00Z";

function running(over: Partial<SharedTrade> = {}): SharedTrade {
  return {
    symbol: "BTCUSDT",
    side: "long",
    entry: 77000,
    stop: 76500,
    targets: [77500, 78000, 78500],
    qty: 0.5,
    leverage: 200,
    state: "open",
    pnl: 122.19,
    locked: 1139.24,
    takesHit: 2,
    margin: 500,
    ...over,
  };
}

describe("карточка идущей сделки", () => {
  it("крупным показывает забранное целями, а не плавающее", () => {
    const card = cardFromShared(running(), AT);
    expect(card.pnl).toBe(1139.24);
    // Процент считается от того же числа: иначе они спорят друг с другом.
    expect(card.roi).toBeCloseTo((1139.24 / 500) * 100, 6);
  });

  it("пишет, сколько целей взято", () => {
    const card = cardFromShared(running(), AT);
    expect(card.rows).toContainEqual(["Цели", "2 из 3"]);
  });

  it("стоп за входом подписан «б/у» и своей ценой", () => {
    const card = cardFromShared(running({ stop: 77000 }), AT);
    const stop = card.rows.find(([label]) => label === "Стоп");
    expect(stop?.[1]).toBe("б/у 77000,00");
  });

  it("стоп в убытке показывается одной ценой, без метки", () => {
    const card = cardFromShared(running(), AT);
    const stop = card.rows.find(([label]) => label === "Стоп");
    expect(stop?.[1]).toBe("76500,00");
  });

  it("без взятых целей и без забранного карточка остаётся честной", () => {
    const card = cardFromShared(running({ takesHit: 0, locked: 0 }), AT);
    expect(card.pnl).toBe(0);
    expect(card.rows).toContainEqual(["Цели", "0 из 3"]);
  });

  it("старое сообщение без поля забранного показывает плавающее", () => {
    // Сообщения, отправленные до этой правки, поля не несут - карточка не
    // должна показать по ним ноль.
    const card = cardFromShared(running({ locked: undefined }), AT);
    expect(card.pnl).toBe(122.19);
  });

  it("у закрытой сделки крупным итог, а цели видно так же", () => {
    const card = cardFromShared(
      running({ state: "closed", pnl: 1500, locked: 900, stop: 78500, takesHit: 3 }),
      AT,
    );
    // Итог закрытой - её собственный, забранное по целям в него уже входит.
    expect(card.pnl).toBe(1500);
    expect(card.rows).toEqual([
      ["Цена входа", "77000,00"],
      ["Цена выхода", "78500,00"],
      // По целям видно, как сделка шла, а не только чем кончилась.
      ["Цели", "3 из 3"],
    ]);
  });

  it("сделка без целей обходится без пустой строки", () => {
    const card = cardFromShared(running({ state: "closed", targets: [] }), AT);
    expect(card.rows.map(([label]) => label)).toEqual(["Цена входа", "Цена выхода"]);
  });
});

describe("безубыток", () => {
  it("лонг: стоп на входе или выше", () => {
    expect(breakeven({ side: "long", entry: 100, stop: 100 })).toBe(true);
    expect(breakeven({ side: "long", entry: 100, stop: 101 })).toBe(true);
    expect(breakeven({ side: "long", entry: 100, stop: 99 })).toBe(false);
  });

  it("шорт: стоп на входе или ниже", () => {
    expect(breakeven({ side: "short", entry: 100, stop: 100 })).toBe(true);
    expect(breakeven({ side: "short", entry: 100, stop: 99 })).toBe(true);
    expect(breakeven({ side: "short", entry: 100, stop: 101 })).toBe(false);
  });

  it("без цен ничего не выдумывает", () => {
    expect(breakeven({ side: "long", entry: 0, stop: 100 })).toBe(false);
    expect(breakeven({ side: "long", entry: 100, stop: 0 })).toBe(false);
  });
});
