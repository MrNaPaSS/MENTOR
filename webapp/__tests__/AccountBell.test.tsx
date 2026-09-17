/**
 * Звонок о счёте по каналу стакана.
 *
 * Терминал спрашивал позиции, заявки и сделки каждые три секунды. Сервер об
 * изменении знает раньше - из приватного потока биржи - и сообщает о нём тем
 * же каналом, где идёт стакан. Круг остаётся запасным путём и на таких биржах
 * идёт втрое реже.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useScalpingFeed } from "@/lib/scalping";

vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost:8000",
  liveAccessToken: async () => "token",
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.last = this;
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.onclose?.();
  }

  say(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const options = {
  symbol: null,
  exchange: "okx",
  rows: 20,
  agg: 1,
  sort: "volume" as const,
  shelf: 50_000,
  interval: "1m",
  foot: 0,
};

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function open(onAccount?: () => void) {
  const view = renderHook(() => useScalpingFeed({ ...options, onAccount }));
  await waitFor(() => expect(FakeSocket.last).not.toBeNull());
  return view;
}

describe("событие счёта", () => {
  it("зовёт круг опроса: об исполнении сервер знает раньше терминала", async () => {
    const asked = vi.fn();
    await open(asked);

    act(() => {
      FakeSocket.last!.say({ event: "account", payload: { reason: "order" } });
    });

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("состав потоков запоминается: по нему круг становится реже", async () => {
    const view = await open();

    act(() => {
      FakeSocket.last!.say({ event: "account", payload: { streamed: ["okx", "binance"] } });
    });

    expect([...view.result.current.streamed].sort()).toEqual(["binance", "okx"]);
  });

  it("состав без повода круг не дёргает: это не изменение на счёте", async () => {
    const asked = vi.fn();
    await open(asked);

    act(() => {
      FakeSocket.last!.say({ event: "account", payload: { streamed: ["okx"] } });
    });

    expect(asked).not.toHaveBeenCalled();
  });

  it("до ответа сервера потоков нет: круг остаётся частым", async () => {
    const view = await open();
    expect(view.result.current.streamed.size).toBe(0);
  });
});
