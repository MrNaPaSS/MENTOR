import { describe, expect, it } from "vitest";

import { cashbackList, cashbackPct, PAYING, PENDING, TRADING, VENUES } from "@/lib/venues";

// Реестр бирж публичных страниц. С сервером его сверяет отдельный тест
// (tests/test_landing_venues.py); здесь - что считается от него, а не руками.

describe("реестр бирж лендинга", () => {
  it("«в ожидании» считается от того же списка, что и карточки", () => {
    expect(TRADING.length + PENDING).toBe(VENUES.length);
    expect(TRADING.every((one) => one.trading)).toBe(true);
  });

  it("возврат обещан только там, где доля названа числом", () => {
    expect(PAYING.map((one) => one.code)).toEqual(["weex", "okx", "bingx", "mexc"]);
    // Binance в списке платящих быть не может: биржа запрещает возврат.
    expect(PAYING.some((one) => one.code === "binance")).toBe(false);
  });

  it("доля в процентах, а ноль и пусто - не проценты", () => {
    expect(cashbackPct(0.15)).toBe("15%");
    expect(cashbackPct(0.1)).toBe("10%");
    expect(cashbackPct(0)).toBeNull();
    expect(cashbackPct(null)).toBeNull();
  });

  it("список для текстов собирается из реестра", () => {
    expect(cashbackList()).toBe("WEEX - 15%, OKX - 10%, BingX - 10%, MEXC - 10%");
  });
});
