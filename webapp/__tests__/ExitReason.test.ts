import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  closeOnExchange,
  createTrade,
  exitReason,
  type ActiveTrade,
} from "@/lib/trade/position";

// Стоп закрывает позицию целиком, и вместе с ней с биржи уходят все цели.
// Терминал принимал это за взятые цели и объявлял «взята цель 3», а следом -
// «сработал стоп». Теперь исход закрытия решает цена выхода, и уведомление
// одно.

vi.mock("@/lib/sound", () => ({ play: vi.fn() }));

/** Лонг от 100: стоп 95, цели 105, 110, 115. */
function longTrade(over: Partial<ActiveTrade> = {}): ActiveTrade {
  return {
    ...createTrade(
      {
        symbol: "ETHUSDT",
        side: "long",
        entry: 100,
        stop: 95,
        targets: [105, 110, 115],
        qty: 2,
        margin: 10,
        leverage: 20,
      },
      "ETHUSDT-1",
      0,
    ),
    status: "open",
    openedAt: 1,
    ...over,
  };
}

/** Шорт от 100: стоп 105, цели 95, 90, 85. */
function shortTrade(over: Partial<ActiveTrade> = {}): ActiveTrade {
  return {
    ...createTrade(
      {
        symbol: "ETHUSDT",
        side: "short",
        entry: 100,
        stop: 105,
        targets: [95, 90, 85],
        qty: 2,
        margin: 10,
        leverage: 20,
      },
      "ETHUSDT-2",
      0,
    ),
    status: "open",
    openedAt: 1,
    ...over,
  };
}

describe("чем закончилась сделка, закрытая биржей", () => {
  it("выход у стопа - стоп, даже с проскальзыванием", () => {
    expect(exitReason(longTrade(), 95)).toBe("stop");
    expect(exitReason(longTrade(), 94.2)).toBe("stop");
    expect(exitReason(shortTrade(), 105.6)).toBe("stop");
  });

  it("выход у ближайшей цели - цель", () => {
    expect(exitReason(longTrade(), 105)).toBe("take");
    expect(exitReason(shortTrade(), 94.9)).toBe("take");
  });

  it("после взятых целей - ближайшей становится следующая", () => {
    // Взяты две, стоп уехал в безубыток: выход у 115 - последняя цель.
    const trade = longTrade({ takesHit: 2, stop: 100.2 });
    expect(exitReason(trade, 115)).toBe("take");
    expect(exitReason(trade, 100.1)).toBe("stop");
  });

  it("все цели взяты - закрыла последняя", () => {
    expect(exitReason(longTrade({ takesHit: 3 }), 0)).toBe("manual");
    expect(exitReason(longTrade({ takesHit: 3 }), 115)).toBe("take");
  });

  it("выход посередине - причину не выдумываем", () => {
    // Закрыли руками в приложении биржи или ликвидация: не стоп и не цель.
    expect(exitReason(longTrade(), 100)).toBe("manual");
  });

  it("цены выхода нет - причину не выдумываем", () => {
    expect(exitReason(longTrade(), 0)).toBe("manual");
  });
});

describe("закрытие на бирже", () => {
  it("итог берёт у биржи, когда он уже записан", () => {
    const closed = closeOnExchange(longTrade(), 97, 5, { exit: 95.1, pnl: -10.4, fee: 0.3 });
    expect(closed.status).toBe("closed");
    expect(closed.outcome).toBe("stop");
    expect(closed.exit).toBe(95.1);
    expect(closed.pnl).toBe(-10.4);
    expect(closed.fee).toBe(0.3);
    expect(closed.onExchange).toBe(true);
  });

  it("без итога биржи оценивает сам по последней цене", () => {
    const closed = closeOnExchange(longTrade(), 105, 5, null);
    expect(closed.outcome).toBe("take");
    expect(closed.exit).toBe(105);
    expect(closed.pnl).toBeGreaterThan(0);
  });

  it("не трогает уже закрытую", () => {
    const done = { ...longTrade(), status: "closed" as const };
    expect(closeOnExchange(done, 95, 5, null)).toBe(done);
  });
});

describe("уведомление о закрытии", () => {
  beforeEach(async () => {
    const alerts = await import("@/lib/tradeAlerts");
    for (const one of alerts.snapshot()) alerts.dismissToast(one.id);
  });

  it("стоп - одно уведомление, «взята цель» по дороге снимается", async () => {
    const { announceClose, pushToast, snapshot } = await import("@/lib/tradeAlerts");
    pushToast({ id: "ETHUSDT-1:take:1", symbol: "ETHUSDT", title: "цель 1", text: "", tone: "up" });

    announceClose(closeOnExchange(longTrade(), 95, 5, { exit: 95, pnl: -10, fee: 0 }));

    const left = snapshot().filter((one) => one.id.startsWith("ETHUSDT-1:"));
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe("ETHUSDT-1:out");
    expect(left[0].text).toContain("сработал стоп");
    expect(left[0].text).toContain("-10.00 $");
  });

  it("стоп после снятого риска называется безубытком, а не убытком", async () => {
    const { announceClose, snapshot } = await import("@/lib/tradeAlerts");
    const trade = longTrade({ takesHit: 1, stop: 100.2, breakeven: true });
    announceClose(closeOnExchange(trade, 100.2, 5, { exit: 100.2, pnl: 9.8, fee: 0 }));
    const one = snapshot().find((toast) => toast.id === "ETHUSDT-1:out");
    expect(one?.text).toContain("стоп в безубыток");
  });

  it("закрытие на бирже без понятной причины не называет его ручным", async () => {
    const { announceClose, snapshot } = await import("@/lib/tradeAlerts");
    announceClose(closeOnExchange(longTrade(), 100, 5, null));
    const one = snapshot().find((toast) => toast.id === "ETHUSDT-1:out");
    expect(one?.text).toContain("позиция закрыта");
    expect(one?.text).not.toContain("вручную");
  });
});
