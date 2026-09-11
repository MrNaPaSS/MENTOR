import { describe, it, expect } from "vitest";
import { marqueeSpan, marqueeSpeed, travelled } from "@/lib/marquee";

// Бегущая строка дёргалась: 28 пикселей в секунду на экране 60 Гц - это 0.47
// пикселя за кадр, сдвиг выпадал то через два кадра, то через три. Скорость
// должна давать пиксель экрана ровно раз в целое число кадров.

/** Кадров на один пиксель экрана при 60 Гц. */
function framesPerPixel(dpr: number): number {
  return 60 / (marqueeSpeed(dpr) * dpr);
}

describe("скорость ленты под экран", () => {
  it.each([1, 1.25, 1.5, 2, 3])("при масштабе %s пиксель экрана - раз в целое число кадров", (dpr) => {
    const frames = framesPerPixel(dpr);
    expect(frames).toBeCloseTo(Math.round(frames), 9);
    expect(frames).toBeGreaterThanOrEqual(1);
  });

  it("на обычном экране - тридцать пикселей в секунду", () => {
    expect(marqueeSpeed(1)).toBe(30);
  });

  it("остаётся близкой к задуманной на любом масштабе", () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      expect(marqueeSpeed(dpr)).toBeGreaterThanOrEqual(15);
      expect(marqueeSpeed(dpr)).toBeLessThanOrEqual(45);
    }
  });

  it("странный масштаб считается обычным", () => {
    expect(marqueeSpeed(0)).toBe(30);
    expect(marqueeSpeed(Number.NaN)).toBe(30);
  });
});

describe("круг ленты", () => {
  it("целое число пикселей экрана", () => {
    // Половина меряется по тексту и выходит дробной.
    expect(marqueeSpan(3601.4, 1)).toEqual({ steps: 3601, css: 3601 });
    const scaled = marqueeSpan(3601.4, 1.25);
    expect(scaled.steps).toBe(4502);
    expect(scaled.css * 1.25).toBeCloseTo(4502, 9);
  });
});

describe("пройденный путь", () => {
  it("остаток от круга", () => {
    expect(travelled(10_000, 30, 1000)).toBeCloseTo(300, 9);
    expect(travelled(40_000, 30, 1000)).toBeCloseTo(200, 9);
  });

  it("без круга - ноль, а не NaN", () => {
    expect(travelled(5000, 30, 0)).toBe(0);
    expect(travelled(Number.NaN, 30, 1000)).toBe(0);
  });
});
