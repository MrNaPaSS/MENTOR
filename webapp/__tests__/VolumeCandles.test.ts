import { describe, it, expect } from "vitest";
import { candleWidth, referenceVolume } from "@/lib/indicator/volumeCandles";

// Толщина свечи - это утверждение о рынке: движение подкреплено деньгами или
// нет. Ошибка здесь не видна как ошибка, поэтому правила проверяются здесь.

describe("объёмные свечи", () => {
  it("опорный объём - медиана, её не сносит одиночный всплеск", () => {
    expect(referenceVolume([10, 12, 11, 9, 1000])).toBe(11);
    expect(referenceVolume([10, 20])).toBe(15);
    expect(referenceVolume([])).toBe(0);
    // Пустые свечи в расчёт не идут: иначе выходной сдвинул бы медиану в ноль.
    expect(referenceVolume([0, 0, 8])).toBe(8);
  });

  it("свеча обычного объёма занимает свою обычную ширину", () => {
    expect(candleWidth(100, 100, 10)).toBeCloseTo(6.8, 5);
  });

  it("больше объёма - толще, меньше - тоньше", () => {
    const spacing = 10;
    const normal = candleWidth(100, 100, spacing);
    expect(candleWidth(400, 100, spacing)).toBeGreaterThan(normal);
    expect(candleWidth(25, 100, spacing)).toBeLessThan(normal);
  });

  it("рост не пропорционален объёму: в полтора раза больше - не в полтора толще", () => {
    const spacing = 100;
    const normal = candleWidth(100, 100, spacing);
    // Корень отношения: объём в 1.44 раза больше даёт ширину в 1.2 раза.
    expect(candleWidth(144, 100, spacing) / normal).toBeCloseTo(1.2, 5);
  });

  it("самая жирная свеча всё равно знает край", () => {
    const spacing = 100;
    const normal = candleWidth(100, 100, spacing);
    // Иначе одна свеча на всплеске закрывает соседей и график не читается.
    expect(candleWidth(1_000_000, 100, spacing) / normal).toBeLessThanOrEqual(1.5);
  });

  it("ширина не выходит за края: ни в нить, ни на соседей", () => {
    const spacing = 10;
    expect(candleWidth(1, 1_000_000, spacing)).toBeGreaterThanOrEqual(1);
    expect(candleWidth(1_000_000, 1, spacing)).toBeLessThanOrEqual(spacing * 0.98);
  });

  it("без объёма ширина обычная, а не нулевая", () => {
    // Свеча без сделок бывает на неликвиде: рисовать её нитью - врать о том,
    // чего мы не знаем.
    expect(candleWidth(0, 100, 10)).toBeCloseTo(6.8, 5);
    expect(candleWidth(100, 0, 10)).toBeCloseTo(6.8, 5);
  });
});
