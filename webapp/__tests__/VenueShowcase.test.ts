import { describe, it, expect, beforeEach, vi } from "vitest";

import { forgetLogin, pendingLogin, ratePct } from "@/lib/exchanges";

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
