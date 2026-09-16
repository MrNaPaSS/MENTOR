// Плавающий результат: точность биржи и скорость стакана.
//
// Биржа считает его от своей средней цены входа, своей цены маркировки и уже
// удержанной комиссии - спорить с ней своей арифметикой значит показывать не
// то число, что на счёте. Но приходит он раз в несколько секунд, и на экране
// стоял, пока в приложении биржи бежал.

import { describe, expect, it } from "vitest";

import { carriedFloating, type ActiveTrade } from "@/lib/trade/position";

function trade(over: Partial<ActiveTrade> = {}): ActiveTrade {
  return {
    id: "t1",
    symbol: "ETHUSDT",
    side: "short",
    status: "open",
    entry: 2415,
    stop: 2425,
    initialStop: 2425,
    targets: [2405],
    takesHit: 0,
    qty: 10,
    leverage: 100,
    realized: 0,
    pnl: 0,
    unrealized: 331.53,
    ...over,
  } as ActiveTrade;
}

describe("плавающий результат", () => {
  it("едет за ценой от числа биржи", () => {
    // Опора: биржа насчитала 331.53 при цене 2415. Цена ушла на доллар вниз -
    // шорт на десяти монетах заработал ещё десять.
    const seen = carriedFloating(trade(), { value: 331.53, price: 2415 }, 2414);
    expect(seen).toBeCloseTo(341.53, 6);
  });

  it("у лонга едет в другую сторону", () => {
    const row = trade({ side: "long", unrealized: 100 });
    expect(carriedFloating(row, { value: 100, price: 2415 }, 2416)).toBeCloseTo(110, 6);
  });

  it("без опоры показывает число биржи, а не свой расчёт", () => {
    // Пока опоры нет, врать своей арифметикой незачем: у биржи число точнее.
    expect(carriedFloating(trade(), null, 2414)).toBeCloseTo(331.53, 6);
  });

  it("биржа промолчала - считаем сами от входа", () => {
    const row = trade({ unrealized: null });
    expect(carriedFloating(row, null, 2414)).toBeCloseTo(10, 6);
  });

  it("закрытая сделка ничего не плавает", () => {
    const row = trade({ status: "closed" });
    expect(carriedFloating(row, { value: 331.53, price: 2415 }, 2400)).toBe(0);
  });

  it("цены нет - остаёмся при числе биржи", () => {
    expect(carriedFloating(trade(), { value: 331.53, price: 2415 }, 0)).toBeCloseTo(331.53, 6);
  });
});
