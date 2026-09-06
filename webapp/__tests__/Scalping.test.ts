import { describe, it, expect } from "vitest";
import { base, money, price,
  priceFormat,
} from "@/lib/scalping";

describe("money", () => {
  it("сокращает крупные суммы - в таблице длинные числа не читаются", () => {
    expect(money(10_800_000)).toBe("10.8M");
    expect(money(342_000)).toBe("342K");
    expect(money(1_250_000_000)).toBe("1.25B");
    expect(money(870)).toBe("870");
  });

  it("сохраняет знак: дельта интересна в обе стороны", () => {
    expect(money(-1_800_000)).toBe("-1.8M");
  });
});

describe("price", () => {
  it("берёт число знаков у шага биржи, а не наугад", () => {
    // Шаг BTC — 0.1, значит один знак после запятой.
    expect(price(79591.7, 0.1)).toBe("79,591.7");
    // Шаг 1.0 — знаки после запятой не нужны вовсе.
    expect(price(79591.0, 1)).toBe("79,591");
  });

  it("без шага подбирает точность по порядку цены", () => {
    // У монет дешевле доллара значащие цифры начинаются далеко после запятой.
    expect(price(0.244845)).toBe("0.244845");
    expect(price(1234.5)).toBe("1,234.50");
  });

  it("пустую цену показывает прочерком, а не нулём", () => {
    expect(price(0)).toBe("-");
  });
});

describe("base", () => {
  it("убирает котируемую валюту: в списке важен тикер монеты", () => {
    expect(base("BTCUSDT")).toBe("BTC");
    expect(base("MARSCOINUSDT")).toBe("MARSCOIN");
  });
});

describe("точность ценовой шкалы", () => {
  // По умолчанию библиотека рисует шкалу с шагом в цент. На DOGE весь видимый
  // диапазон меньше этого шага: подписи выходят одинаковыми, а одинаковые она
  // не показывает - шкала справа оказывалась пустой при живых ценах в стакане.

  it("берёт биржевой шаг, когда он известен", () => {
    expect(priceFormat(0.00001)).toEqual({ precision: 5, minMove: 0.00001 });
    expect(priceFormat(0.1)).toEqual({ precision: 1, minMove: 0.1 });
    expect(priceFormat(1)).toEqual({ precision: 0, minMove: 1 });
  });

  it("без шага смотрит на саму цену", () => {
    // Биткойн: центы не нужны, десятая доллара - в самый раз.
    expect(priceFormat(0, 80000).precision).toBe(1);
    // DOGE: без знаков после третьего вся шкала схлопнется в одно число.
    expect(priceFormat(0, 0.15).precision).toBeGreaterThanOrEqual(4);
  });

  it("глубже восьми знаков не уходит: дальше это уже не цена", () => {
    expect(priceFormat(0.0000000001).precision).toBe(8);
  });
});
