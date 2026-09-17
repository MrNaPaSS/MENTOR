/**
 * Цена монеты так, как её читают.
 *
 * У биткоина сотые доллара в цели не значат ничего, у монеты за доллар в них
 * весь ход. Поэтому знаков столько, сколько нужно этой цене, а не столько,
 * сколько прислала биржа.
 */

import { describe, it, expect } from "vitest";

import { priceText } from "@/lib/journalFormat";

describe("цена в журнале", () => {
  it("крупную монету округляет до целого", () => {
    expect(priceText(76610.2131)).toBe("76 610");
    expect(priceText(2473.88)).toBe("2 474");
  });

  it("монету дешевле тысячи пишет до сотых", () => {
    expect(priceText(123.456)).toBe("123.46");
    expect(priceText(1.2931)).toBe("1.29");
  });

  it("мелкую монету не превращает в ноль", () => {
    expect(priceText(0.0723)).toBe("0.0723");
    expect(priceText(0.00004521)).toBe("0.000045");
  });

  it("не выдумывает число там, где его нет", () => {
    expect(priceText(Number.NaN)).toBe("-");
    expect(priceText(Number.POSITIVE_INFINITY)).toBe("-");
  });
});
