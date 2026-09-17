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

import { breakeven, cardFromShared, cardFromTrade } from "@/lib/pnl/data";
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

  it("стоп за входом: метка у подписи, цена остаётся ценой", () => {
    const card = cardFromShared(running({ stop: 77000 }), AT);
    expect(card.rows).toContainEqual(["Стоп б/у", "77000,00"]);
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


describe("карточка из журнала", () => {
  it("у идущей сделки на месте выхода стоит стоп, и он может быть в б/у", () => {
    const card = cardFromTrade({
      id: 1,
      client_id: "t-1",
      symbol: "BTCUSDT",
      side: "short",
      entry: 77000,
      // В журнале записан стоп, с которым сделка задумывалась: по нему риск.
      stop: 77600,
      // А на бирже он уже за входом.
      stop_now: 77000,
      exit_price: null,
      qty: 0.5,
      margin: 500,
      leverage: 200,
      takes_hit: 2,
      fee: 0,
      targets: [76500, 76200, 75800],
      outcome: "open",
      pnl: 1139.24,
      live: true,
      closed_qty: 0.3,
      opened_at: "2026-09-17T16:28:00Z",
      closed_at: null,
      note: "в работе",
      exchange: "weex",
    });

    expect(card.pnl).toBe(1139.24);
    expect(card.rows).toEqual([
      ["Цена входа", "77000,00"],
      ["Стоп б/у", "77000,00"],
      ["Цели", "2 из 3"],
    ]);
    // Заверяем временем входа: даты закрытия у неё ещё нет.
    expect(card.at).toBe("2026-09-17T16:28:00Z");
  });

  it("закрытая сделка из журнала - как была, плюс цели", () => {
    const card = cardFromTrade({
      id: 2,
      client_id: "t-2",
      symbol: "ETHUSDT",
      side: "long",
      entry: 2428.88,
      stop: 2400,
      exit_price: 2441.71,
      qty: 1,
      margin: 200,
      leverage: 200,
      takes_hit: 3,
      fee: 28.51,
      targets: [2435, 2440, 2445],
      outcome: "take",
      pnl: 927.65,
      opened_at: "2026-09-17T14:00:00Z",
      closed_at: "2026-09-17T14:11:00Z",
      note: "биржа",
      exchange: "weex",
    });

    expect(card.rows).toEqual([
      ["Цена входа", "2428,88"],
      ["Цена выхода", "2441,71"],
      ["Цели", "3 из 3"],
    ]);
    expect(card.at).toBe("2026-09-17T14:11:00Z");
  });
});
