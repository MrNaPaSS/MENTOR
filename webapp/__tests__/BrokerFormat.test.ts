import { describe, it, expect } from "vitest";
import {
  compactMoney,
  money,
  moneyPrecise,
  rate,
  share,
} from "@/lib/broker/format";

// Форматирование здесь своё, а не из Intl, ровно по одной причине: страница
// собирается в Node, а открывается в браузере, и таблицы форматов у них
// расходятся невидимыми пробелами. Для React это другой текст - гидратация
// падает целиком, и вместе с ней перестаёт работать всё остальное на
// странице. Тесты сторожат именно посимвольное совпадение, поэтому сравнение
// строгое, до неразрывного пробела.

const NBSP = " ";

describe("деньги", () => {
  it("разряды по-русски отбиты неразрывным пробелом, знак после числа", () => {
    expect(money(840_000, "ru")).toBe(`840${NBSP}000${NBSP}$`);
  });

  it("по-английски запятая и знак впереди", () => {
    expect(money(840_000, "en")).toBe("$840,000");
  });

  it("мелкие суммы показываются с копейками, крупные - без", () => {
    expect(moneyPrecise(19.6, "ru")).toBe(`19,60${NBSP}$`);
    expect(moneyPrecise(19.6, "en")).toBe("$19.60");
    expect(moneyPrecise(571.4, "ru")).toBe(`571${NBSP}$`);
  });

  it("минус остаётся перед знаком доллара, а не между ним и числом", () => {
    expect(moneyPrecise(-94.5, "en")).toBe("-$94.50");
    expect(moneyPrecise(-94.5, "ru")).toBe(`-94,50${NBSP}$`);
  });

  it("ноль не превращается в пустое место", () => {
    expect(money(0, "ru")).toBe(`0${NBSP}$`);
    expect(money(0, "en")).toBe("$0");
  });
});

describe("короткая запись оборота", () => {
  it("тысячи и миллионы на обоих языках", () => {
    expect(compactMoney(47_368, "ru")).toBe(`47${NBSP}тыс.${NBSP}$`);
    expect(compactMoney(47_368, "en")).toBe("$47K");
    expect(compactMoney(2_800_000, "ru")).toBe(`2,8${NBSP}млн${NBSP}$`);
    expect(compactMoney(2_800_000, "en")).toBe("$2.8M");
  });

  it("круглый миллион пишется без нуля после запятой", () => {
    expect(compactMoney(2_000_000, "ru")).toBe(`2${NBSP}млн${NBSP}$`);
    expect(compactMoney(2_000_000, "en")).toBe("$2M");
  });

  it("суммы меньше тысячи остаются как есть", () => {
    expect(compactMoney(0, "ru")).toBe(`0${NBSP}$`);
    expect(compactMoney(500, "en")).toBe("$500");
  });

  it("бесконечный порог - это знак бесконечности, а не «$NaN»", () => {
    expect(compactMoney(Infinity, "ru")).toBe("∞");
  });
});

describe("проценты", () => {
  it("ставка комиссии - три знака, и третий не округляется", () => {
    expect(rate(0.0008, "ru")).toBe(`0,080${NBSP}%`);
    expect(rate(0.0008, "en")).toBe("0.080%");
    expect(rate(0.00056, "ru")).toBe(`0,056${NBSP}%`);
  });

  it("доля возврата - целые проценты", () => {
    expect(share(0.25, "ru")).toBe(`25${NBSP}%`);
    expect(share(0.25, "en")).toBe("25%");
  });
});

describe("устойчивость к среде", () => {
  it("ни один результат не содержит узкого пробела - именно на нём расходятся Node и браузер", () => {
    const samples = [
      money(1_234_567, "ru"),
      moneyPrecise(-19.6, "ru"),
      compactMoney(5_000_000, "ru"),
      rate(0.00055, "ru"),
      share(0.4, "ru"),
    ];
    for (const text of samples) {
      expect(text).not.toContain(" ");
      expect(text).not.toContain(" ");
    }
  });
});
