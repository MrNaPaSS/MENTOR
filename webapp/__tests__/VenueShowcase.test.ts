import { describe, it, expect, beforeEach, vi } from "vitest";

import { cashbackKind, cashbackPct, forgetLogin, pendingLogin, ratePct } from "@/lib/exchanges";

// Витрина бирж: ставки и начатый вход биржей.
//
// Ставка, которой биржа не подтвердила, показывается словами «условия
// уточняются», а не нулём: обещание скидки, которой нет, ученик запомнит, а
// оговорку нет.

describe("ставка на витрине", () => {
  it("доли единицы превращаются в проценты", () => {
    expect(ratePct(0.0005)).toBe("0.05%");
    expect(ratePct(0.0008)).toBe("0.08%");
    expect(ratePct(0.0002)).toBe("0.02%");
  });

  it("неподтверждённая ставка - пусто, а не ноль", () => {
    expect(ratePct(null)).toBeNull();
    expect(ratePct(undefined)).toBeNull();
    expect(ratePct(0)).toBeNull();
  });
});

describe("возврат комиссии на карточке", () => {
  it("доля названа - возвращаем и говорим сколько", () => {
    expect(cashbackKind({ cashback: 0.15, trading: true })).toBe("pays");
    expect(cashbackPct(0.15)).toBe("15%");
    expect(cashbackPct(0.1)).toBe("10%");
  });

  // Ноль пришёл с сервера намеренно: Binance запрещает партнёрам делиться
  // комиссией. Показать здесь «уточняется» значит пообещать несуществующее.
  it("ноль - это «не будет», а не «пока не знаем»", () => {
    expect(cashbackKind({ cashback: 0, trading: true })).toBe("forbidden");
    expect(cashbackPct(0)).toBeNull();
  });

  it("биржа подключена, а долю не назвали - уточняется", () => {
    expect(cashbackKind({ cashback: null, trading: true })).toBe("unknown");
  });

  it("биржи в терминале ещё нет - условий по ней и быть не может", () => {
    expect(cashbackKind({ cashback: null, trading: false })).toBe("waiting");
  });
});

describe("начатый вход биржей", () => {
  beforeEach(() => {
    forgetLogin();
  });

  it("пусто, пока вход не начинали", () => {
    expect(pendingLogin()).toBeNull();
  });

  it("битое хранилище не роняет страницу", () => {
    sessionStorage.setItem("nmnh.exchange.login", "не json");
    expect(pendingLogin()).toBeNull();
  });

  it("недописанное состояние не считается входом", () => {
    sessionStorage.setItem("nmnh.exchange.login", JSON.stringify({ exchange: "okx" }));
    expect(pendingLogin()).toBeNull();
  });

  it("целое состояние возвращается как есть", () => {
    sessionStorage.setItem(
      "nmnh.exchange.login",
      JSON.stringify({ exchange: "okx", state: "подпись" }),
    );
    expect(pendingLogin()).toEqual({ exchange: "okx", state: "подпись" });
  });

  it("приватное окно: хранилище недоступно - входа просто нет", () => {
    const broken = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("заблокировано");
    });
    expect(pendingLogin()).toBeNull();
    broken.mockRestore();
  });
});
