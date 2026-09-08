import { describe, it, expect } from "vitest";
import {
  ROW,
  ROW_MIN,
  ROWS,
  cellHeat,
  rowBudget,
  rowHeight,
  traceTail,
} from "@/lib/indicator/footprintLayout";
import { foldRows, stepForRows, type FootprintLevel } from "@/lib/indicator/footprint";

// Разбор свечи - это утверждение о том, где прошли деньги. Ошибка в раскладке
// не выглядит ошибкой: картинка нарисуется стройной, просто соврёт. Поэтому
// мерка проверяется числами.

describe("сколько строк разрешено", () => {
  it("на обычной крупности - все", () => {
    expect(rowBudget(1)).toBe(ROWS);
  });

  it("ступень делит число строк", () => {
    expect(rowBudget(2)).toBe(ROWS / 2);
    expect(rowBudget(4)).toBe(ROWS / 4);
  });

  it("совсем без строк картинки не бывает", () => {
    // Даже самая грубая ступень обязана оставить свече хоть какую-то высоту.
    expect(rowBudget(100)).toBeGreaterThanOrEqual(4);
  });

  it("крупность мельче единицы ничего не добавляет", () => {
    // Ноль и минус приходят из хранилища, куда мог залезть кто угодно.
    expect(rowBudget(0)).toBe(ROWS);
    expect(rowBudget(-3)).toBe(ROWS);
  });
});

describe("свеча растёт вместе со сделками", () => {
  function level(price: number): FootprintLevel {
    return { price, buy: 1, sell: 1 };
  }

  it("только что открытая стоит одной строкой", () => {
    // Первая сделка прошла на одной цене - и показать надо ровно её.
    const step = stepForRows(0.1, 0, rowBudget(1));
    expect(foldRows([level(100)], step)).toHaveLength(1);
  });

  it("пошли цены - пошли строки", () => {
    const levels = [level(100), level(100.1), level(100.2)];
    const span = 0.2;
    const step = stepForRows(0.1, span, rowBudget(1));
    expect(foldRows(levels, step)).toHaveLength(3);
  });

  it("разошлась широко - строки собираются в более крупный шаг", () => {
    // Час торговли на биткойне - три сотни шагов биржи. В столбик они не
    // влезают ни на каком экране, и лестница обязана огрубеть сама.
    const levels = Array.from({ length: 300 }, (_, i) => level(100 + i * 0.1));
    const step = stepForRows(0.1, 29.9, rowBudget(1));
    expect(foldRows(levels, step).length).toBeLessThanOrEqual(ROWS);
    expect(foldRows(levels, step).length).toBeGreaterThan(ROWS / 2);
  });

  it("грубая ступень оставляет вдвое меньше строк", () => {
    const levels = Array.from({ length: 300 }, (_, i) => level(100 + i * 0.1));
    const fine = foldRows(levels, stepForRows(0.1, 29.9, rowBudget(1))).length;
    const rough = foldRows(levels, stepForRows(0.1, 29.9, rowBudget(2))).length;
    expect(rough).toBeLessThan(fine);
  });
});

describe("высота строки", () => {
  it("места хватает - строка обычная", () => {
    expect(rowHeight(10, 1000)).toBe(ROW);
  });

  it("места мало - строка ужимается", () => {
    const tall = rowHeight(20, 260);
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
