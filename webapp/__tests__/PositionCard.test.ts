/**
 * Цифры карточки позиции: сессия входа и отношение риска к цели.
 *
 * Это то, что раньше приходилось считать в голове по строке журнала: во
 * сколько раз цель дальше стопа и в какую сессию шла торговля. Обе цифры
 * выводятся из уже записанного, без единого нового поля у сделки.
 */

import { describe, it, expect } from "vitest";

import { riskReward, sessionOf } from "@/components/scalping/PositionCard";

describe("риск к цели", () => {
  it("считает от входа и стопа до дальней цели", () => {
    // Риск 100, дальняя цель в 400 от входа - один к четырём.
    expect(
      riskReward({ entry: 1000, stop: 900, targets: [1100, 1250, 1400] }),
    ).toBeCloseTo(4, 6);
  });

  it("шорт считается так же: важна дистанция, а не сторона", () => {
    expect(riskReward({ entry: 1000, stop: 1100, targets: [800, 600] })).toBeCloseTo(4, 6);
  });

  it("без целей или без стопа не выдумывает число", () => {
    expect(riskReward({ entry: 1000, stop: 900, targets: [] })).toBe(0);
    expect(riskReward({ entry: 1000, stop: 1000, targets: [1200] })).toBe(0);
  });
});

describe("сессия входа", () => {
  it("раскладывает час входа по сессиям", () => {
    expect(sessionOf("2026-09-17T03:00:00Z")).toBe("asia");
    expect(sessionOf("2026-09-17T09:00:00Z")).toBe("london");
    expect(sessionOf("2026-09-17T14:00:00Z")).toBe("newYork");
    expect(sessionOf("2026-09-17T20:00:00Z")).toBe("evening");
  });

  it("без времени входа возвращает первую сессию, а не падает", () => {
    expect(sessionOf(null)).toBe("asia");
  });
});
