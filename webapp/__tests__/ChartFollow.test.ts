import { describe, expect, it } from "vitest";
import {
  HISTORY_GAP_BARS,
  RETURN_TO_LIVE_MS,
  inHistory,
  rangeMoved,
} from "@/lib/chartFollow";

describe("inHistory", () => {
  const total = 400;

  it("живое положение историей не считается: справа у графика своё поле", () => {
    expect(inHistory({ from: 250, to: total + 14 }, total)).toBe(false);
    expect(inHistory({ from: 250, to: total }, total)).toBe(false);
  });

  it("пара свечей туда-сюда - это дрожь прокрутки, а не прогулка", () => {
    expect(inHistory({ from: 250, to: total - HISTORY_GAP_BARS }, total)).toBe(false);
  });

  it("ушли назад - значит в истории", () => {
    expect(inHistory({ from: 100, to: 260 }, total)).toBe(true);
  });

  it("без диапазона и без данных решать нечего", () => {
    expect(inHistory(null, total)).toBe(false);
    expect(inHistory({ from: 0, to: 10 }, 0)).toBe(false);
  });
});

describe("rangeMoved", () => {
  it("первый замер - это движение: до него сравнивать не с чем", () => {
    expect(rangeMoved(null, { from: 1, to: 2 })).toBe(true);
  });

  it("мелкая поправка от новых данных отсчёт не перезапускает", () => {
    expect(rangeMoved({ from: 10, to: 20 }, { from: 10.2, to: 20.3 })).toBe(false);
  });

  it("человек листнул - движение", () => {
    expect(rangeMoved({ from: 10, to: 20 }, { from: 4, to: 14 })).toBe(true);
  });

  it("человек приблизил - тоже движение", () => {
    expect(rangeMoved({ from: 10, to: 20 }, { from: 13, to: 20 })).toBe(true);
  });

  it("пустой диапазон ничего не меняет", () => {
    expect(rangeMoved({ from: 10, to: 20 }, null)).toBe(false);
  });
});

describe("срок возврата", () => {
  it("полминуты: хватает разглядеть историю и мало, чтобы пропустить движение", () => {
    expect(RETURN_TO_LIVE_MS).toBe(30_000);
  });
});
