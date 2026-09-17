/**
 * Где стоял график, когда его оставили.
 *
 * Память эта нужна на час-другой: вернуться к найденному участку после
 * перезагрузки и похода в аналитику. Вчерашний участок сегодня уже вреден -
 * открывать утренний терминал на позавчерашнем движении хуже, чем на свежих
 * свечах.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { keepView, readView, viewFits, VIEW_TTL_MS } from "@/lib/chartView";

describe("память графика", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("возвращает то, что запомнили, по монете и таймфрейму", () => {
    keepView("BTCUSDT", "1m", 1000, 2000);
    keepView("ETHUSDT", "1m", 5000, 6000);

    expect(readView("BTCUSDT", "1m")).toMatchObject({ from: 1000, to: 2000 });
    expect(readView("ETHUSDT", "1m")).toMatchObject({ from: 5000, to: 6000 });
    // Другой таймфрейм - другое положение: на пятиминутке смотрят другое.
    expect(readView("BTCUSDT", "5m")).toBeNull();
  });

  it("бессмысленный диапазон не запоминает", () => {
    keepView("BTCUSDT", "1m", 2000, 1000);
    keepView("BTCUSDT", "1m", Number.NaN, 1000);
    expect(readView("BTCUSDT", "1m")).toBeNull();
  });

  it("забывает старое положение", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:00Z"));
    keepView("BTCUSDT", "1m", 1000, 2000);
    expect(readView("BTCUSDT", "1m")).not.toBeNull();

    vi.setSystemTime(new Date("2026-09-18T10:00:00Z").getTime() + VIEW_TTL_MS + 1000);
    expect(readView("BTCUSDT", "1m")).toBeNull();
  });

  it("не ложится на участок, которого нет в присланных свечах", () => {
    // Свечи с 5000 по 9000: участок до них восстанавливать не на чем.
    expect(viewFits({ from: 1000, to: 2000, at: Date.now() }, 5000, 9000)).toBe(false);
    expect(viewFits({ from: 6000, to: 7000, at: Date.now() }, 5000, 9000)).toBe(true);
  });

  it("правый край с пустым полем впереди считается своим", () => {
    // Трейдер оставил график у правого края: справа пустое поле, и конец
    // видимого участка лежит за последней свечой - это нормально.
    expect(viewFits({ from: 8000, to: 9600, at: Date.now() }, 5000, 9000)).toBe(true);
  });
});
