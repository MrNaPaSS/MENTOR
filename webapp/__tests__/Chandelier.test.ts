import { describe, it, expect } from "vitest";
import {
  activeLevel,
  computeChandelier,
  CE_LENGTH,
  CE_MULT,
} from "@/lib/indicator/chandelier";
import type { Candle } from "@/lib/indicator/types";

// Уровень считается из своего же прошлого значения: ошибка в одном сравнении
// превращает динамическую поддержку в линию, которая ползёт вниз вместе с
// ценой и ничего не держит. Глазами это не отличить от правильной — только
// по числам.

function candle(i: number, o: number, h: number, l: number, c: number): Candle {
  return { time: 1_700_000_000 + i * 60, open: o, high: h, low: l, close: c, volume: 100 };
}

/** Ровный рост, потом обвал. */
function upThenDown(): Candle[] {
  const out: Candle[] = [];
  let i = 0;
  for (let p = 100; p <= 160; p += 2) out.push(candle(i++, p - 1, p + 1, p - 2, p));
  for (let p = 158; p >= 60; p -= 2) out.push(candle(i++, p + 1, p + 2, p - 1, p));
  return out;
}

describe("настройки", () => {
  it("совпадают со скриптом: ATR 22 и множитель 3", () => {
    expect(CE_LENGTH).toBe(22);
    expect(CE_MULT).toBe(3);
  });
});

describe("уровень", () => {
  const { bars } = computeChandelier(upThenDown());

  it("считается не с первого бара — ATR нужен разгон", () => {
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThan(upThenDown().length);
  });

  it("направление меняется по пробою уровня предыдущего бара", () => {
    // Это дословное правило из скрипта: сравнение идёт с уровнем, который
    // стоял на прошлом баре, а не с пересчитанным на текущем. Если сравнить с
    // текущим, уровень поедет за ценой и перестанет быть уровнем.
    const byTime = new Map(upThenDown().map((c) => [c.time, c]));
    for (let i = 1; i < bars.length; i++) {
      const close = byTime.get(bars[i].time)!.close;
      const previous = bars[i - 1];
      const expected =
        close > previous.shortStop ? 1 : close < previous.longStop ? -1 : previous.dir;
      expect(bars[i].dir).toBe(expected);
    }
  });

  it("на росте поддержка только подтягивается вверх", () => {
    const rising = bars.filter((b) => b.dir === 1);
    for (let i = 1; i < rising.length; i++) {
      // Внутри одного направления уровень не отступает назад.
      if (rising[i].time - rising[i - 1].time === 60) {
        expect(rising[i].longStop).toBeGreaterThanOrEqual(rising[i - 1].longStop - 1e-9);
      }
    }
  });

  it("заливка идёт от уровня до средней цены бара", () => {
    const candles = upThenDown();
    const byTime = new Map(candles.map((c) => [c.time, c]));
    const bar = bars[0];
    const c = byTime.get(bar.time)!;
    expect(bar.mid).toBeCloseTo((c.open + c.high + c.low + c.close) / 4, 10);
  });
});

describe("развороты", () => {
  it("смена направления отмечается один раз", () => {
    const { bars, signals } = computeChandelier(upThenDown());
    let changes = 0;
    for (let i = 1; i < bars.length; i++) if (bars[i].dir !== bars[i - 1].dir) changes++;
    expect(signals.length).toBe(changes);
    expect(changes).toBeGreaterThan(0);
  });

  it("обвал переводит уровень в сопротивление", () => {
    const { signals } = computeChandelier(upThenDown());
    expect(signals.some((s) => s.dir === -1)).toBe(true);
  });
});

describe("устойчивость", () => {
  it("пустой ввод не роняет расчёт", () => {
    expect(computeChandelier([])).toEqual({ bars: [], signals: [] });
  });

  it("истории меньше окна ATR — просто нет уровня", () => {
    const short = upThenDown().slice(0, 3);
    expect(computeChandelier(short).bars.length).toBe(0);
  });
});
