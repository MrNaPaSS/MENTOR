/**
 * Зафиксированное по взятым целям.
 *
 * Живая строка результата считает по открытому остатку - ровно как биржа.
 * После двух взятых целей она показывала +7 там, где на счёте уже лежало 30:
 * забранное по целям в ней не участвует и не должно, иначе число разойдётся с
 * приложением биржи. Поэтому оно стоит рядом отдельно, и приходит с сервера -
 * из журнала, по исполнениям биржи.
 */

import { describe, it, expect } from "vitest";

import { createTrade, pnlAt } from "@/lib/trade/position";

function openTrade(over: Partial<ReturnType<typeof createTrade>> = {}) {
  return {
    ...createTrade(
      {
        symbol: "BTCUSDT",
        side: "long",
        entry: 100,
        stop: 98,
        targets: [102, 104, 106],
        qty: 3,
        margin: 100,
        leverage: 10,
      },
      "t-1",
      Date.now(),
    ),
    status: "open" as const,
    ...over,
  };
}

describe("зафиксированное по целям", () => {
  it("не смешивается с плавающим: итог считается отдельно", () => {
    // Две цели взяты, в позиции остался один контракт, цена ушла к 103.
    const trade = openTrade({ qty: 1, realized: 6, takesHit: 2 });

    // Плавающее по остатку - три доллара, забранное - шесть.
    expect(pnlAt(trade, 103)).toBeCloseTo(9, 6);
  });

  it("сделка без взятых целей ничего не фиксирует", () => {
    const trade = openTrade();
    expect(trade.realized).toBe(0);
    expect(pnlAt(trade, 101)).toBeCloseTo(3, 6);
  });

  it("число сервера заменяет наш расчёт целиком", () => {
    // Наш расчёт по замыслу целей дал бы ровно (102-100)*1 + (104-100)*1 = 6,
    // а биржа после проскальзывания и комиссии насчитала меньше. Берём её.
    const ours = openTrade({ qty: 1, realized: 6, takesHit: 2 });
    const fromServer = { ...ours, realized: 5.4 };

    expect(pnlAt(fromServer, 103)).toBeCloseTo(8.4, 6);
    expect(pnlAt(fromServer, 103)).toBeLessThan(pnlAt(ours, 103));
  });
});
