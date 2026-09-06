import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCoins, COINS_EVENT } from "@/lib/useCoins";
import { setStudentTokens } from "@/lib/auth";

/** Подменяем fetch: хук ходит в /api/coins через общий клиент. */
function mockCoins(values: number[]) {
  let i = 0;
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ balance: values[Math.min(i++, values.length - 1)], transactions: [] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useCoins", () => {
  beforeEach(() => {
    localStorage.clear();
    setStudentTokens("token", "refresh");
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("загружает баланс при монтировании", async () => {
    mockCoins([195]);
    const { result } = renderHook(() => useCoins());
    await waitFor(() => expect(result.current.coins).toBe(195));
  });

  it("перезапрашивает при смене раздела", async () => {
    const f = mockCoins([195, 255]);
    const { result, rerender } = renderHook(({ k }) => useCoins(k), {
      initialProps: { k: "/app/analysis" },
    });
    await waitFor(() => expect(result.current.coins).toBe(195));

    rerender({ k: "/app/shop" });
    await waitFor(() => expect(result.current.coins).toBe(255));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("обновляется при возврате на вкладку — монеты мог начислить бот академии", async () => {
    const f = mockCoins([195, 255]);
    const { result } = renderHook(() => useCoins());
    await waitFor(() => expect(result.current.coins).toBe(195));

    // Пауза больше защитного интервала: человек уходил проходить урок.
    await act(async () => {
      vi.advanceTimersByTime(6000);
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.coins).toBe(255));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("не долбит сервер при частых событиях фокуса", async () => {
    const f = mockCoins([195]);
    renderHook(() => useCoins());
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("берёт баланс прямо из события покупки, без лишнего запроса", async () => {
    const f = mockCoins([255]);
    const { result } = renderHook(() => useCoins());
    await waitFor(() => expect(result.current.coins).toBe(255));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(COINS_EVENT, { detail: { balance: 180 } }),
      );
    });
    expect(result.current.coins).toBe(180);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("событие без числа заставляет перезапросить", async () => {
    const f = mockCoins([195, 300]);
    const { result } = renderHook(() => useCoins());
    await waitFor(() => expect(result.current.coins).toBe(195));

    await act(async () => {
      window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail: {} }));
    });
    await waitFor(() => expect(result.current.coins).toBe(300));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("без токена в сеть не ходит", async () => {
    localStorage.clear();
    const f = mockCoins([195]);
    const { result } = renderHook(() => useCoins());
    expect(f).not.toHaveBeenCalled();
    expect(result.current.coins).toBeNull();
  });

  it("при сбое сети сохраняет прежнее число, а не обнуляет витрину", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: true, status: 200, json: async () => ({ balance: 195, transactions: [] }) };
      }
      throw new Error("сеть недоступна");
    }));

    const { result } = renderHook(() => useCoins());
    await waitFor(() => expect(result.current.coins).toBe(195));

    await act(async () => {
      vi.advanceTimersByTime(6000);
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.coins).toBe(195));
  });
});
