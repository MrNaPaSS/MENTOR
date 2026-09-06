import { describe, it, expect } from "vitest";
import { crossedAlerts, type PriceAlert } from "@/lib/trade/alerts";

// Отметку ставят, чтобы не сидеть над стаканом. Значит два требования: не
// пропустить пересечение и не звенеть, пока рынок просто стоит выше уровня.

const at = (price: number, symbol = "BTCUSDT"): PriceAlert => ({
  id: `a-${symbol}-${price}`,
  symbol,
  price,
});

describe("отметки на ценах", () => {
  it("срабатывает на переходе через уровень в любую сторону", () => {
    const alerts = [at(100)];
    expect(crossedAlerts(alerts, "BTCUSDT", 99, 101)).toHaveLength(1);
    expect(crossedAlerts(alerts, "BTCUSDT", 101, 99)).toHaveLength(1);
  });

  it("молчит, пока цена по одну сторону", () => {
    const alerts = [at(100)];
    expect(crossedAlerts(alerts, "BTCUSDT", 101, 105)).toEqual([]);
    expect(crossedAlerts(alerts, "BTCUSDT", 99, 98)).toEqual([]);
  });

  it("касание уровня - это и есть событие", () => {
    expect(crossedAlerts([at(100)], "BTCUSDT", 99.5, 100)).toHaveLength(1);
  });

  it("чужая монета не звенит", () => {
    expect(crossedAlerts([at(100, "SOLUSDT")], "BTCUSDT", 99, 101)).toEqual([]);
  });

  it("первого кадра недостаточно: сравнивать не с чем", () => {
    // До первой цены прошлого кадра нет, и «пересечение» означало бы, что
    // отметка сработает сама при открытии монеты.
    expect(crossedAlerts([at(100)], "BTCUSDT", 0, 101)).toEqual([]);
  });

  it("сразу несколько отметок в одном движении", () => {
    const alerts = [at(100), at(102), at(110)];
    expect(crossedAlerts(alerts, "BTCUSDT", 99, 103).map((a) => a.price)).toEqual([100, 102]);
  });
});
