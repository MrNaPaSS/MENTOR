/**
 * Общая память панелей рынка.
 *
 * Проверяется то, ради чего она заведена: значение переживает переход между
 * разделами, два запроса за одним ключом не уходят дважды, и упавший источник
 * не стирает то, что уже показано.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { dropAll, peek, put, refresh } from "@/lib/paneCache";

beforeEach(() => {
  dropAll();
  vi.useRealTimers();
});

describe("память", () => {
  it("отдаёт положенное сразу, без запроса", () => {
    put("global", { cap: 1 });
    expect(peek<{ cap: number }>("global")?.value).toEqual({ cap: 1 });
  });

  it("пустая до первого запроса", () => {
    expect(peek("trending")).toBeNull();
  });

  it("забывает всё разом: экран переходит другому человеку", () => {
    put("global", { cap: 1 });
    dropAll();
    expect(peek("global")).toBeNull();
  });
});

describe("refresh", () => {
  it("свежее значение источник не беспокоит", async () => {
    const loader = vi.fn(async () => ({ cap: 2 }));
    await refresh("global", loader, 60_000);
    await refresh("global", loader, 60_000);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("истёк срок - спрашиваем заново", async () => {
    const loader = vi.fn(async () => ({ cap: 3 }));
    await refresh("global", loader, 0);
    await refresh("global", loader, 0);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("две панели на одном ключе идут одним запросом", async () => {
    let release: (value: { cap: number }) => void = () => {};
    const loader = vi.fn(
      () => new Promise<{ cap: number }>((resolve) => (release = resolve)),
    );

    const first = refresh("tickers", loader, 0);
    const second = refresh("tickers", loader, 0);
    release({ cap: 4 });

    expect(await first).toEqual({ cap: 4 });
    expect(await second).toEqual({ cap: 4 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("упавший источник не стирает показанное", async () => {
    put("global", { cap: 5 });
    const broken = vi.fn(async () => {
      throw new Error("источник молчит");
    });

    await expect(refresh("global", broken, 0)).rejects.toThrow();

    expect(peek<{ cap: number }>("global")?.value).toEqual({ cap: 5 });
  });

  it("после падения следующий запрос уходит: полёт закончился", async () => {
    const broken = vi.fn(async () => {
      throw new Error("источник молчит");
    });
    await expect(refresh("onchain", broken, 0)).rejects.toThrow();
    await expect(refresh("onchain", broken, 0)).rejects.toThrow();
    expect(broken).toHaveBeenCalledTimes(2);
  });
});
