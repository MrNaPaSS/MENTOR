import { describe, it, expect } from "vitest";
import {
  advance,
  closeManually,
  createTrade,
  pendingTargets,
  pnlAt,
  type ActiveTrade,
} from "@/lib/trade/position";

// Сделка из этого файла попадает в журнал и в календарь прибыли. Ошибка здесь
// не рисуется на графике — она оседает в статистике трейдера, поэтому каждый
// переход зафиксирован тестом.

const T0 = 1_700_000_000_000;

function long(): ActiveTrade {
  return createTrade(
    {
      symbol: "BTCUSDT",
      side: "long",
      entry: 100,
      stop: 99,
      targets: [101, 102, 103],
      qty: 10,
      margin: 100,
      leverage: 10,
    },
    "t1",
  );
}

function short(): ActiveTrade {
  return createTrade(
    {
      symbol: "BTCUSDT",
      side: "short",
      entry: 100,
      stop: 101,
      targets: [99, 98, 97],
      qty: 10,
      margin: 100,
      leverage: 10,
    },
    "t2",
  );
}

describe("вход", () => {
  it("сделка ждёт, пока цена не дошла до уровня", () => {
    const trade = advance(long(), 100.5, T0);
    expect(trade.status).toBe("planned");
    expect(pnlAt(trade, 100.5)).toBe(0);
  });

  it("касание уровня открывает лонг", () => {
    const trade = advance(long(), 100, T0);
    expect(trade.status).toBe("open");
    expect(trade.openedAt).toBe(T0);
  });

  it("шорт открывается ценой сверху", () => {
    expect(advance(short(), 99.5, T0).status).toBe("planned");
    expect(advance(short(), 100, T0).status).toBe("open");
  });

  it("состояние без изменений возвращается той же ссылкой", () => {
    const trade = long();
    expect(advance(trade, 100.5, T0)).toBe(trade);
  });
});

describe("прибыль и убыток", () => {
  it("плавающий результат считается по объёму", () => {
    const trade = advance(long(), 100, T0);
    expect(pnlAt(trade, 100.5)).toBeCloseTo(5, 10);
    expect(pnlAt(trade, 99.5)).toBeCloseTo(-5, 10);
  });

  it("у шорта знак обратный", () => {
    const trade = advance(short(), 100, T0);
    expect(pnlAt(trade, 99)).toBeCloseTo(10, 10);
    expect(pnlAt(trade, 101)).toBeCloseTo(-10, 10);
  });
});

describe("цели", () => {
  it("взятая цель уходит с графика", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 101, T0 + 1);
    expect(trade.takesHit).toBe(1);
    expect(pendingTargets(trade)).toEqual([102, 103]);
  });

  it("после первой цели стоп переезжает в безубыток", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 101, T0 + 1);
    expect(trade.breakeven).toBe(true);
    expect(trade.stop).toBe(100);

    // Возврат к входу закрывает сделку в ноль, а не в минус.
    trade = advance(trade, 100, T0 + 2);
    expect(trade.status).toBe("closed");
    expect(trade.pnl).toBeCloseTo(0, 10);
  });

  it("рывок через несколько целей засчитывает их все", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 102.5, T0 + 1);
    expect(trade.takesHit).toBe(2);
    expect(trade.status).toBe("open");
  });

  it("последняя цель закрывает сделку", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 103, T0 + 1);
    expect(trade.status).toBe("closed");
    expect(trade.outcome).toBe("take");
    expect(trade.pnl).toBeCloseTo(30, 10);
  });
});

describe("стоп", () => {
  it("закрывает сделку по цене стопа, а не по цене тика", () => {
    let trade = advance(long(), 100, T0);
    // Рынок провалился ниже стопа: в журнал идёт стоп, а не дно свечи.
    trade = advance(trade, 98, T0 + 1);
    expect(trade.status).toBe("closed");
    expect(trade.exit).toBe(99);
    expect(trade.pnl).toBeCloseTo(-10, 10);
  });

  it("в одном тике стоп важнее цели", () => {
    // Цена ушла и вверх, и вниз — что рынок задел первым, неизвестно.
    let trade = advance(long(), 100, T0);
    trade = { ...trade, stop: 99 };
    expect(advance(trade, 98, T0 + 1).outcome).toBe("stop");
  });

  it("закрытая сделка больше не меняется", () => {
    let trade = advance(long(), 100, T0);
    trade = advance(trade, 98, T0 + 1);
    expect(advance(trade, 105, T0 + 2)).toBe(trade);
  });
});

describe("закрытие руками", () => {
  it("считает результат по текущей цене", () => {
    let trade = advance(long(), 100, T0);
    trade = closeManually(trade, 100.7, T0 + 1);
    expect(trade.outcome).toBe("manual");
    expect(trade.pnl).toBeCloseTo(7, 10);
  });

  it("неоткрытая сделка закрывается в ноль", () => {
    const trade = closeManually(long(), 100.7, T0 + 1);
    expect(trade.status).toBe("closed");
    expect(trade.pnl).toBe(0);
  });
});
