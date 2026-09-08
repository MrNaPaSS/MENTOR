// Показания индикатора: балл и осциллятор объёма.
//
// Главное здесь - средняя объёма. Ряд, по которому она считается, начинается
// пропусками по построению, и прежняя скользящая сумма отравлялась ими
// навсегда: средняя не появлялась ни разу за весь ряд, а панель показывала
// прочерк на месте числа.

import { describe, expect, it } from "vitest";

import { sma } from "@/lib/indicator/ta";
import { readout, tenth } from "@/lib/indicator/score";
import type { Candle } from "@/lib/indicator/types";

describe("средняя скользящим окном", () => {
  it("считает обычный ряд", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([Number.NaN, 1.5, 2.5, 3.5]);
  });

  it("переживает пропуски в начале ряда", () => {
    const out = sma([Number.NaN, Number.NaN, 2, 4, 6], 2);
    // Окно с пропуском остаётся пропуском, а следующие за ним - считаются.
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(5);
  });

  it("пропуск в середине не ломает всё, что после него", () => {
    const out = sma([1, 1, Number.NaN, 3, 3], 2);
    expect(out[3]).toBeNaN();
    expect(out[4]).toBe(3);
  });
});

/** Свечи с растущим объёмом: на них средняя обязана посчитаться. */
function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: 1_700_000_000 + i * 60,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i * 1.5,
    volume: 1000 + i * 25,
  }));
}

describe("показания панели", () => {
  it("на коротком ряду молчат, а не выдают ноль за спокойный рынок", () => {
    const short = readout(candles(10));
    expect(short.long).toBe(0);
    expect(short.short).toBe(0);
    expect(short.vo).toBeNaN();
  });

  it("на достаточном ряду средняя объёма есть", () => {
    const now = readout(candles(200));
    expect(Number.isFinite(now.vo)).toBe(true);
    // Ровно то, из-за чего панель показывала прочерк.
    expect(Number.isFinite(now.voSma)).toBe(true);
    expect(tenth(now.voSma)).not.toBe("—");
  });

  it("балл лежит между нулём и четырьмя: условий четыре", () => {
    const now = readout(candles(200));
    for (const value of [now.long, now.short]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(4);
    }
  });
});
