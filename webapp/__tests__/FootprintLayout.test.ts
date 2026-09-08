import { describe, it, expect } from "vitest";
import {
  ROW,
  ROW_MIN,
  ROWS,
  cellHeat,
  rowHeight,
  traceTail,
} from "@/lib/indicator/footprintLayout";
import { foldRows, stepForRows, type FootprintLevel } from "@/lib/indicator/footprint";

// Разбор свечи - это утверждение о том, где прошли деньги. Ошибка в раскладке
// не выглядит ошибкой: картинка нарисуется стройной, просто соврёт. Поэтому
// мерка проверяется числами.

describe("свеча растёт вместе со сделками", () => {
  function level(price: number): FootprintLevel {
    return { price, buy: 1, sell: 1 };
  }

  it("только что открытая стоит одной строкой", () => {
    // Первая сделка прошла на одной цене - и показать надо ровно её.
    const step = stepForRows(0.1, 0, ROWS);
    expect(foldRows([level(100)], step)).toHaveLength(1);
  });

  it("пошли цены - пошли строки", () => {
    const levels = [level(100), level(100.1), level(100.2)];
    const span = 0.2;
    const step = stepForRows(0.1, span, ROWS);
    expect(foldRows(levels, step)).toHaveLength(3);
  });

  it("разошлась широко - строки собираются в более крупный шаг", () => {
    // Час торговли на биткойне - три сотни шагов биржи. В столбик они не
    // влезают ни на каком экране, и лестница обязана огрубеть сама.
    const levels = Array.from({ length: 300 }, (_, i) => level(100 + i * 0.1));
    const step = stepForRows(0.1, 29.9, ROWS);
    expect(foldRows(levels, step).length).toBeLessThanOrEqual(ROWS);
    expect(foldRows(levels, step).length).toBeGreaterThan(ROWS / 2);
  });

});

describe("высота строки", () => {
  it("места хватает - строка обычная", () => {
    expect(rowHeight(10, 1000)).toBe(ROW);
  });

  it("места мало - строка ужимается", () => {
    // Места ровно на четыре пятых от обычной высоты - считаем от неё самой,
    // чтобы проверка пережила смену размера картинки.
    const tall = rowHeight(20, 20 * ROW * 0.8);
    expect(tall).toBeLessThan(ROW);
    expect(tall).toBeGreaterThanOrEqual(ROW_MIN);
  });

  it("ниже читаемой не опускается", () => {
    // Лучше обрезать картинку, чем показать серую полосу вместо цифр.
    expect(rowHeight(200, 100)).toBe(ROW_MIN);
  });

  it("пустая свеча высоту не считает", () => {
    expect(rowHeight(0, 500)).toBe(ROW);
  });
});

describe("след и густота", () => {
  it("самый крупный бьёт на всю отведённую ширину", () => {
    expect(traceTail(100, 100, 84)).toBeCloseTo(84, 6);
  });

  it("больший объём всегда бьёт дальше меньшего", () => {
    expect(traceTail(50, 100, 84)).toBeGreaterThan(traceTail(10, 100, 84));
  });

  it("мелочь видна, а не лежит в ноль", () => {
    // Долей она дала бы один пиксель, и картинка стала бы одной полосой
    // посреди пустоты.
    expect(traceTail(1, 100, 84)).toBeGreaterThan(4);
  });

  it("пустой строки следа нет", () => {
    expect(traceTail(0, 100, 84)).toBe(0);
    expect(traceTail(10, 0, 84)).toBe(0);
  });

  it("густота растёт вместе с объёмом и остаётся в пределах", () => {
    expect(cellHeat(1, 100)).toBeGreaterThan(0);
    expect(cellHeat(1, 100)).toBeLessThan(cellHeat(100, 100));
    expect(cellHeat(100, 100)).toBeLessThanOrEqual(1);
  });

  it("объём больше опоры не выводит густоту за единицу", () => {
    // Опора считается по видимым строкам, а сервер отдаёт итоги по всем:
    // разойтись они могут, и прозрачность выше единицы холст рисует чёрным.
    expect(cellHeat(500, 100)).toBeLessThanOrEqual(1);
    expect(traceTail(500, 100, 84)).toBeCloseTo(84, 6);
  });

  it("пустой строки не красим", () => {
    expect(cellHeat(0, 100)).toBe(0);
  });
});
