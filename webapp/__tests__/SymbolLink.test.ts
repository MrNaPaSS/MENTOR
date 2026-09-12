/**
 * Активный символ и привязка панелей (ТЗ этап 5, §8.1).
 *
 * Состояние живёт вне React и в хранилище, поэтому проверяется здесь: привязанная
 * панель следует за символом, отвязанная - нет, и вторая вкладка не расходится
 * с первой.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SYMBOL,
  cleanSymbol,
  isLinked,
  readActiveSymbol,
  setActiveSymbol,
  setLinked,
  symbolFor,
} from "@/lib/symbolLink";

beforeEach(() => {
  localStorage.clear();
});

describe("активный символ", () => {
  it("по умолчанию биткоин", () => {
    expect(readActiveSymbol()).toBe(DEFAULT_SYMBOL);
  });

  it("запоминается и переживает перезагрузку", () => {
    setActiveSymbol("solusdt");
    expect(readActiveSymbol()).toBe("SOLUSDT");
    expect(localStorage.getItem("nmnh.symbol.active")).toBe("SOLUSDT");
  });

  it("мусором не подменяется: чужая пара - это чужая цена", () => {
    setActiveSymbol("SOLUSDT");
    setActiveSymbol("не пара");
    setActiveSymbol("");
    expect(readActiveSymbol()).toBe("SOLUSDT");
  });

  it("не падает на испорченном хранилище", () => {
    localStorage.setItem("nmnh.symbol.active", "{}{}");
    expect(readActiveSymbol()).toBe(DEFAULT_SYMBOL);
  });
});

describe("привязка панели", () => {
  it("по умолчанию привязана: человек ждёт в панели ту пару, что смотрит", () => {
    expect(isLinked("dom")).toBe(true);
  });

  it("привязанная панель следует за символом", () => {
    setActiveSymbol("TONUSDT");
    expect(symbolFor("dom", "ETHUSDT")).toBe("TONUSDT");
  });

  it("отвязанная стоит на своей паре", () => {
    setLinked("dom", false);
    setActiveSymbol("TONUSDT");
    expect(symbolFor("dom", "ETHUSDT")).toBe("ETHUSDT");
  });

  it("отвязанная без своей пары показывает активную, а не пустоту", () => {
    setLinked("dom", false);
    setActiveSymbol("TONUSDT");
    expect(symbolFor("dom", null)).toBe("TONUSDT");
  });

  it("привязки у панелей свои", () => {
    setLinked("dom", false);
    expect(isLinked("dom")).toBe(false);
    expect(isLinked("chart")).toBe(true);
  });

  it("привязка переживает перезагрузку", () => {
    setLinked("chart", false);
    expect(JSON.parse(localStorage.getItem("nmnh.symbol.linked") || "{}")).toEqual({
      chart: false,
    });
  });

  it("испорченная запись привязок не ломает панель", () => {
    localStorage.setItem("nmnh.symbol.linked", "не json");
    expect(isLinked("dom")).toBe(true);
  });
});

describe("cleanSymbol", () => {
  it("приводит к общему виду", () => {
    expect(cleanSymbol(" btcusdt ")).toBe("BTCUSDT");
  });

  it("отказывает всему, что не похоже на пару", () => {
    expect(cleanSymbol("BTC USDT")).toBeNull();
    expect(cleanSymbol("BTC/USDT")).toBeNull();
    expect(cleanSymbol(null)).toBeNull();
  });
});
