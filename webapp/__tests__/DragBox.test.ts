import { describe, it, expect, beforeEach } from "vitest";
import { clampSpot, keepSpot, readSpot } from "@/lib/dragBox";

// Панель, уехавшую за край холста, вернуть нечем: ухватить её можно только за
// заголовок, а он уехал вместе с ней. Поэтому границы проверяются числами.

const KEY = "test.spot";

describe("панель держится в пределах холста", () => {
  const box = { w: 200, h: 100 };
  const area = { w: 1000, h: 500 };

  it("посреди холста остаётся там, где её отпустили", () => {
    expect(clampSpot({ x: 300, y: 200 }, box, area)).toEqual({ x: 300, y: 200 });
  });

  it("за правым и нижним краем прижимается к нему", () => {
    expect(clampSpot({ x: 9000, y: 9000 }, box, area)).toEqual({ x: 796, y: 396 });
  });

  it("за левым и верхним — тоже", () => {
    expect(clampSpot({ x: -500, y: -500 }, box, area)).toEqual({ x: 4, y: 4 });
  });

  it("панель шире холста показывает своё начало", () => {
    // Там заголовок, за который её и тянут: спрятать его значит запереть
    // панель на экране навсегда.
    expect(clampSpot({ x: 300, y: 200 }, { w: 4000, h: 4000 }, area)).toEqual({ x: 4, y: 4 });
  });
});

describe("память о месте", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("что положили, то и достаём", () => {
    keepSpot(KEY, { x: 12, y: 34 });
    expect(readSpot(KEY)).toEqual({ x: 12, y: 34 });
  });

  it("пусто — значит панель ещё не переезжала", () => {
    expect(readSpot(KEY)).toBeNull();
  });

  it("испорченная запись не считается местом", () => {
    // Нечисло, попавшее в стиль, унесло бы панель с экрана насовсем.
    localStorage.setItem(KEY, '{"x":"нет","y":3}');
    expect(readSpot(KEY)).toBeNull();
    localStorage.setItem(KEY, "не json");
    expect(readSpot(KEY)).toBeNull();
  });

  it("забыть место можно", () => {
    keepSpot(KEY, { x: 1, y: 2 });
    keepSpot(KEY, null);
    expect(readSpot(KEY)).toBeNull();
  });
});
