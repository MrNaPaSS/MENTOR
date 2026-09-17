/**
 * Время в сделке: считается из того, что записал сервер.
 *
 * Цифра простая, но ошибиться в ней легко: у идущей сделки нет времени
 * закрытия, а у записи, подхваченной задним числом, времени открытия может не
 * быть вовсе. Ни в том, ни в другом случае журнал не должен показывать
 * выдуманное число.
 */

import { describe, it, expect } from "vitest";

import { heldLabel, heldSeconds } from "@/lib/tradeTime";

const UNITS = { h: "ч", m: "мин", s: "с" };

describe("время в сделке", () => {
  it("считает от входа до закрытия", () => {
    expect(
      heldSeconds({
        opened_at: "2026-09-15T10:00:00Z",
        closed_at: "2026-09-15T12:14:00Z",
      }),
    ).toBe(2 * 3600 + 14 * 60);
  });

  it("у идущей сделки считает до сейчас", () => {
    const now = Date.parse("2026-09-15T10:30:00Z");
    expect(
      heldSeconds({ opened_at: "2026-09-15T10:00:00Z", closed_at: null }, now),
    ).toBe(1800);
  });

  it("без времени входа ничего не выдумывает", () => {
    expect(heldSeconds({ opened_at: null, closed_at: "2026-09-15T12:00:00Z" })).toBe(0);
    expect(heldSeconds({ opened_at: "нет", closed_at: null })).toBe(0);
  });

  it("пишет словами по крупным единицам", () => {
    expect(heldLabel(48, UNITS)).toBe("48 с");
    expect(heldLabel(14 * 60 + 9, UNITS)).toBe("14 мин");
    expect(heldLabel(2 * 3600 + 14 * 60, UNITS)).toBe("2 ч 14 мин");
    expect(heldLabel(3 * 3600, UNITS)).toBe("3 ч");
    expect(heldLabel(0, UNITS)).toBe("-");
  });
});
