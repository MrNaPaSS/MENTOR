/**
 * Цифры счёта под звёздочками.
 *
 * Аналитику открывают не только наедине: разбор в трансляции, экран на созвоне,
 * скриншот в чат. Кнопка закрывает оборот, комиссию и движение денег, а выбор
 * запоминается - закрыл однажды, и раздел так и открывается закрытым.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { HIDE_KEY, MASK, maskValue, numbersHidden, rememberHidden } from "@/lib/analytics/hideNumbers";

beforeEach(() => {
  localStorage.clear();
});

describe("память выбора", () => {
  it("по умолчанию цифры открыты: прячет их человек, а не мы", () => {
    expect(numbersHidden()).toBe(false);
  });

  it("выбор переживает перезагрузку страницы", () => {
    rememberHidden(true);
    expect(localStorage.getItem(HIDE_KEY)).toBe("1");
    expect(numbersHidden()).toBe(true);
  });

  it("открыли обратно - в хранилище ничего не остаётся", () => {
    rememberHidden(true);
    rememberHidden(false);
    expect(localStorage.getItem(HIDE_KEY)).toBeNull();
    expect(numbersHidden()).toBe(false);
  });

  it("запрет на хранилище не ломает раздел", () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("приватное окно");
    };
    try {
      expect(numbersHidden()).toBe(false);
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});

describe("маска", () => {
  it("закрывает число звёздочками постоянной длины", () => {
    // Длина постоянная: по ней не угадать, миллион там или сотня.
    expect(maskValue("$8,56M", true)).toBe(MASK);
    expect(maskValue("$155", true)).toBe(MASK);
  });

  it("открытые цифры не трогает", () => {
    expect(maskValue("$8,56M", false)).toBe("$8,56M");
  });

  it("прочерк остаётся прочерком: скрывать нечего", () => {
    expect(maskValue("-", true)).toBe("-");
  });
});
