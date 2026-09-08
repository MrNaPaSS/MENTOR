import { describe, it, expect } from "vitest";
import {
  buildRows,
  foldRows,
  markRows,
  stepForRows,
  parseFootprint,
  pickStep,
  type FootprintLevel,
} from "@/lib/indicator/footprint";

// Раскрытая свеча — это утверждение о рынке: вот здесь стояли покупатели, а
// вот тут одна плита, после которой цену вынесли на пустоте. Ошибка в разметке
// не выглядит ошибкой: колонка нарисуется стройной, просто не про то. Поэтому
// правила проверяются числами.

function level(price: number, buy: number, sell: number): FootprintLevel {
  return { price, buy, sell };
}

describe("шаг строк", () => {
  it("строка не бывает тоньше, чем нужно числу", () => {
    // Цена точки экрана 0.05, строке нужно двенадцать точек - это 0.6, то есть
    // шесть биржевых шагов по 0.1.
    expect(pickStep(0.1, 0.05, 12)).toBeCloseTo(0.6, 8);
  });

  it("шаг остаётся целым числом биржевых шагов", () => {
    // Половина шага биржи ценой не бывает: строки встали бы между реальными
    // ценами, и трейдер читал бы объём на цене, которой нет.
    const step = pickStep(0.1, 0.017, 12);
    expect(Math.round(step / 0.1)).toBeCloseTo(step / 0.1, 8);
  });

  it("на крупном масштабе строки остаются на шаге биржи", () => {
    // Свеча растянута во весь экран - укрупнять нечего.
    expect(pickStep(0.1, 0.001, 12)).toBeCloseTo(0.1, 8);
  });

  it("без шага биржи строк нет", () => {
    expect(pickStep(0, 0.05, 12)).toBe(0);
  });
});

describe("схлопывание строк", () => {
  it("соседние цены собираются в одну строку", () => {
    const rows = foldRows([level(100.0, 10, 0), level(100.1, 5, 5)], 0.5);
    expect(rows).toHaveLength(1);
    expect(rows[0].buy).toBe(15);
    expect(rows[0].sell).toBe(5);
    expect(rows[0].total).toBe(20);
    expect(rows[0].delta).toBe(10);
  });

  it("строки идут сверху вниз - как стакан рядом", () => {
    const rows = foldRows([level(100.0, 1, 0), level(101.0, 1, 0)], 0.5);
    expect(rows.map((r) => r.price)).toEqual([101.0, 100.0]);
  });

  it("корзины непрерывны: один объём не виден дважды", () => {
    // Округление к ближайшей строке дало бы перекрытие соседних корзин.
    const rows = foldRows([level(100.4, 1, 0), level(100.6, 1, 0)], 0.5);
    expect(rows.map((r) => r.price)).toEqual([100.5, 100.0]);
  });

  it("объём при схлопывании не теряется", () => {
    const levels = Array.from({ length: 30 }, (_, i) => level(100 + i * 0.1, 2, 1));
    const rows = foldRows(levels, 1);
    expect(rows.reduce((acc, r) => acc + r.total, 0)).toBeCloseTo(90, 6);
  });

  it("цена ровно на границе корзины остаётся в своей строке", () => {
    // 129.9 / 0.3 в двоичной арифметике даёт 432.9999999 - без округления
    // цена уезжала бы строкой ниже.
    const rows = foldRows([level(129.9, 1, 0)], 0.3);
    expect(rows[0].price).toBeCloseTo(129.9, 6);
  });
});

describe("разметка строк", () => {
  it("POC - самая наторгованная цена свечи", () => {
    const rows = markRows(foldRows([level(101, 1, 1), level(100, 10, 10)], 1));
    expect(rows.find((r) => r.poc)?.price).toBe(100);
    expect(rows.filter((r) => r.poc)).toHaveLength(1);
  });

  it("кит - строка, переросшая и соседей, и свою долю в свече", () => {
    const levels = [
      ...Array.from({ length: 10 }, (_, i) => level(100 + i, 1, 1)),
      level(120, 40, 40),
    ];
    const rows = markRows(foldRows(levels, 1));
    expect(rows.filter((r) => r.whale).map((r) => r.price)).toEqual([120]);
  });

  it("на ровной свече китов нет вовсе", () => {
    // Иначе жёлтым заливалась бы половина свечи, и метка перестала бы что-то
    // значить.
    const rows = markRows(foldRows(Array.from({ length: 10 }, (_, i) => level(100 + i, 5, 5)), 1));
    expect(rows.some((r) => r.whale)).toBe(false);
  });

  it("имбаланс считается по диагонали, а не по своей же цене", () => {
    // Покупатель берёт по цене продавца: сравнивать его надо с продавцом
    // строкой ниже - с тем, кто стоял там же, где он бил.
    const rows = markRows(
      foldRows([level(101, 100, 0), level(100, 0, 1), level(99, 0, 100)], 1),
    );
    expect(rows.find((r) => r.price === 101)?.imbalance).toBe(1);
    expect(rows.find((r) => r.price === 99)?.imbalance).toBe(-1);
  });

  it("мелочь имбалансом не считается", () => {
    // На копеечной строке втрое больше встречной бывает всегда - метка на ней
    // не значит ничего.
    const rows = markRows(
      foldRows([level(101, 1, 0), level(100, 0, 0), level(99, 5000, 5000)], 1),
    );
    expect(rows.find((r) => r.price === 101)?.imbalance).toBe(0);
  });

  it("пустая свеча размечается без падения", () => {
    expect(markRows([])).toEqual([]);
  });
});

describe("ответ сервера", () => {
  it("строки приходят тройками и раскладываются по полям", () => {
    const data = parseFootprint({
      symbol: "BTCUSDT",
      interval: "1m",
      time: 60,
      seconds: 60,
      tick: 0.1,
      buy: 30,
      sell: 10,
      partial: false,
      source: "tape",
      levels: [
        [100.1, 20, 5],
        [100.0, 10, 5],
      ],
    });
    expect(data.levels[0]).toEqual({ price: 100.1, buy: 20, sell: 5 });
    expect(data.partial).toBe(false);
  });

  it("строки под масштаб собираются одним вызовом", () => {
    const data = parseFootprint({
      symbol: "BTCUSDT",
      interval: "1m",
      time: 60,
      seconds: 60,
      tick: 0.1,
      buy: 4,
      sell: 0,
      levels: [
        [100.0, 1, 0],
        [100.1, 1, 0],
        [100.2, 1, 0],
        [100.3, 1, 0],
      ],
    });
    // Цена точки 0.1, строке нужно двенадцать точек - все четыре цены
    // складываются в одну строку.
    const rows = buildRows(data, 0.1, 12);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(4);
    expect(rows[0].poc).toBe(true);
  });

  it("без данных строк нет", () => {
    expect(buildRows(null, 0.1, 12)).toEqual([]);
  });
});

describe("строки под карточку", () => {
  // В карточке высоту строки задаёт вёрстка: укрупнение считается от того,
  // сколько строк она готова показать, а не от масштаба графика.
  it("свеча укладывается в отведённое число строк", () => {
    // Размах 10, шаг биржи 0.1 - это сто цен. В двадцать строк они лягут по
    // пять шагов в строке.
    // Не 0.5: на отрезке в десять единиц корзины по 0.5 дают двадцать одну
    // строку, а не двадцать - границы не совпадают с началом отрезка.
    expect(stepForRows(0.1, 10, 20)).toBeCloseTo(0.6, 8);
  });

  it("мелкая свеча остаётся на шаге биржи", () => {
    // Пять цен на двадцать строк - укрупнять нечего.
    expect(stepForRows(0.1, 0.5, 20)).toBeCloseTo(0.1, 8);
  });

  it("шаг остаётся целым числом биржевых шагов", () => {
    const step = stepForRows(0.1, 3.7, 12);
    expect(Math.round(step / 0.1)).toBeCloseTo(step / 0.1, 8);
  });

  it("без шага биржи строк нет", () => {
    expect(stepForRows(0, 10, 20)).toBe(0);
  });
});
