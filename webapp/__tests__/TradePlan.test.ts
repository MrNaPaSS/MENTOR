import { describe, it, expect } from "vitest";
import {
  computeTrade,
  sideForShelf,
  suggestStopPct,
  DEFAULT_TAKES,
  MAX_STOP_PCT,
} from "@/lib/trade/plan";

// Расчёт сделки — единственное место в разделе, где ошибка стоит трейдеру
// денег напрямую. Проверяем не «функция что-то вернула», а сами числа.

describe("сторона сделки", () => {
  it("полка в покупках — это поддержка, значит лонг", () => {
    expect(sideForShelf("bid")).toBe("long");
  });

  it("полка в продажах — сопротивление, значит шорт", () => {
    expect(sideForShelf("ask")).toBe("short");
  });
});

describe("расчёт лонга", () => {
  const plan = computeTrade({
    entry: 100,
    side: "long",
    stopPct: 1,
    margin: 200,
    leverage: 10,
    takes: DEFAULT_TAKES,
  })!;

  it("стоп ниже входа на заданный процент", () => {
    expect(plan.stop).toBeCloseTo(99, 10);
  });

  it("объём позиции — маржа на плечо", () => {
    expect(plan.notional).toBe(2000);
    expect(plan.qty).toBeCloseTo(20, 10);
  });

  it("риск считается по объёму, а не по марже", () => {
    // 20 монет × доллар до стопа.
    expect(plan.risk).toBeCloseTo(20, 10);
    expect(plan.riskPct).toBeCloseTo(10, 10);
  });

  it("цели отмеряются в R от входа вверх", () => {
    expect(plan.targets.map((t) => t.price)).toEqual([101, 102, 103]);
    expect(plan.targets.map((t) => Math.round(t.profit))).toEqual([20, 40, 60]);
  });

  it("ликвидация — на расстоянии одной маржи", () => {
    expect(plan.liquidation).toBeCloseTo(90, 10);
    expect(plan.liquidatedFirst).toBe(false);
  });
});

describe("расчёт шорта", () => {
  const plan = computeTrade({
    entry: 100,
    side: "short",
    stopPct: 2,
    margin: 50,
    leverage: 5,
    takes: [1, 2],
  })!;

  it("стоп выше входа, цели ниже", () => {
    expect(plan.stop).toBeCloseTo(102, 10);
    expect(plan.targets.map((t) => t.price)).toEqual([98, 96]);
  });

  it("соотношение берётся по последней цели", () => {
    expect(plan.rr).toBe(2);
  });
});

describe("опасные вводы", () => {
  it("стоп за ликвидацией отмечен отдельно", () => {
    // Плечо 50 — ликвидация в двух процентах, а стоп поставлен в трёх.
    const plan = computeTrade({
      entry: 100,
      side: "long",
      stopPct: 3,
      margin: 100,
      leverage: 50,
      takes: DEFAULT_TAKES,
    })!;
    expect(plan.liquidatedFirst).toBe(true);
  });

  it("пустой или отрицательный ввод не считается", () => {
    const base = { entry: 100, side: "long" as const, takes: DEFAULT_TAKES };
    expect(computeTrade({ ...base, stopPct: 1, margin: 0, leverage: 10 })).toBeNull();
    expect(computeTrade({ ...base, stopPct: 0, margin: 100, leverage: 10 })).toBeNull();
    expect(computeTrade({ ...base, entry: 0, stopPct: 1, margin: 100, leverage: 10 })).toBeNull();
  });

  it("стоп шире цены входа не даёт отрицательной цены стопа", () => {
    expect(
      computeTrade({
        entry: 100,
        side: "long",
        stopPct: 120,
        margin: 100,
        leverage: 2,
        takes: [1],
      }),
    ).toBeNull();
  });
});

describe("стоп по волатильности", () => {
  it("половина ATR в процентах от цены", () => {
    expect(suggestStopPct(2, 100)).toBeCloseTo(1, 3);
  });

  it("без данных о волатильности даёт рабочее значение", () => {
    expect(suggestStopPct(0, 100)).toBeGreaterThan(0);
    expect(suggestStopPct(2, 0)).toBeGreaterThan(0);
  });

  it("не выходит за границы разумного стопа", () => {
    expect(suggestStopPct(1000, 100)).toBe(MAX_STOP_PCT);
  });
});
