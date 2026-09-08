import { describe, it, expect } from "vitest";
import { light, mix, readableInk, toRgb } from "@/lib/indicator/ink";

// Цифра, пропавшая на своей же подложке, - ошибка, которую видно только на той
// монете и том пресете, где так сошлось. Поэтому выбор чернил считается, а не
// подбирается на глаз, и проверяется числами.

describe("разбор цвета", () => {
  it("шестнадцатеричная запись, длинная и короткая", () => {
    expect(toRgb("#ff0080")).toEqual({ r: 255, g: 0, b: 128 });
    expect(toRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(toRgb("  #0ECB81  ")).toEqual({ r: 14, g: 203, b: 129 });
  });

  it("rgb и rgba", () => {
    expect(toRgb("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(toRgb("rgba(10,20,30,0.4)")).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("незнакомая запись - это не цвет, а повод отступить", () => {
    expect(toRgb("var(--pane-up)")).toBeNull();
    expect(toRgb("")).toBeNull();
    expect(toRgb("тёмно-синий")).toBeNull();
  });
});

describe("смешивание с фоном", () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };

  it("непрозрачная краска фон не пускает", () => {
    expect(mix(black, white, 1)).toEqual(black);
  });

  it("прозрачная краска не видна вовсе", () => {
    expect(mix(black, white, 0)).toEqual(white);
  });

  it("половина даёт середину", () => {
    expect(mix(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });

  it("доля за пределами отрезка не выносит цвет за него", () => {
    // Густота считается от объёма, и разойтись с опорой она может.
    expect(mix(black, white, 5)).toEqual(black);
    expect(mix(black, white, -5)).toEqual(white);
  });
});

describe("яркость", () => {
  it("белое ярче чёрного", () => {
    expect(light({ r: 255, g: 255, b: 255 })).toBe(1);
    expect(light({ r: 0, g: 0, b: 0 })).toBe(0);
  });

  it("зелёное ярче синего той же силы", () => {
    // Среднее объявило бы их одинаковыми, и синяя ячейка получила бы тёмные
    // чернила, на которых её не прочесть.
    expect(light({ r: 0, g: 255, b: 0 })).toBeGreaterThan(light({ r: 0, g: 0, b: 255 }));
  });
});

describe("чернила под подложку", () => {
  const DARK = "#111418";
  const BRIGHT = "#f5f7fa";

  it("на светлой ячейке пишем тёмным", () => {
    expect(readableInk("#ffffff", "#ffffff", 0.8, DARK, BRIGHT)).toBe(DARK);
  });

  it("на тёмной - светлым", () => {
    // Белый лист, падение чёрное: тёмная цифра на нём пропала бы совсем.
    expect(readableInk("#000000", "#ffffff", 0.85, DARK, BRIGHT)).toBe(BRIGHT);
  });

  it("бледная ячейка остаётся светлой подложкой", () => {
    // Двенадцать процентов чёрного на белом - это почти белое.
    expect(readableInk("#000000", "#ffffff", 0.12, DARK, BRIGHT)).toBe(DARK);
  });

  it("на тёмном листе бледная ячейка требует светлых чернил", () => {
    expect(readableInk("#f6465d", "#181a20", 0.2, DARK, BRIGHT)).toBe(BRIGHT);
  });

  it("цвет, который не разобрать, чернил не меняет", () => {
    expect(readableInk("var(--pane-up)", "#181a20", 0.8, DARK, BRIGHT)).toBe(DARK);
  });
});
