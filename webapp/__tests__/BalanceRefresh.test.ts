import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BALANCE_DELAY_MS, createBalanceRefresher } from "@/lib/balanceRefresh";

// После входа и выхода баланс не обновлялся, и окно заявки считало свободные
// деньги от устаревшей цифры. Обновление уходит само, но одно на пачку
// событий: вход, набор позиции и цели приходят за секунду-другую.

describe("обновление баланса после сделок", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("уходит не сразу, а после паузы", async () => {
    const refresh = vi.fn();
    const one = createBalanceRefresher(refresh);
    one.request();
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BALANCE_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("пачка событий - один запрос", async () => {
    const refresh = vi.fn();
    const one = createBalanceRefresher(refresh);
    one.request();
    await vi.advanceTimersByTimeAsync(500);
    one.request();
    await vi.advanceTimersByTimeAsync(500);
    one.request();
    await vi.advanceTimersByTimeAsync(BALANCE_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("события через время - отдельные запросы", async () => {
    const refresh = vi.fn();
    const one = createBalanceRefresher(refresh);
    one.request();
    await vi.advanceTimersByTimeAsync(BALANCE_DELAY_MS);
    one.request();
    await vi.advanceTimersByTimeAsync(BALANCE_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("отменённый запрос не уходит", async () => {
    const refresh = vi.fn();
    const one = createBalanceRefresher(refresh);
    one.request();
    one.cancel();
    await vi.advanceTimersByTimeAsync(BALANCE_DELAY_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("сбой обновления не роняет следующее", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("биржа молчит"));
    const one = createBalanceRefresher(refresh);
    one.request();
    await vi.advanceTimersByTimeAsync(BALANCE_DELAY_MS);
    one.request();
    await vi.advanceTimersByTimeAsync(BALANCE_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
