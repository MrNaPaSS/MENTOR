import { describe, it, expect } from "vitest";
import { atr, ema, highest, lowest, rma, rsi, sma, trueRange } from "@/lib/indicator/ta";
import { computeVision, DEFAULTS, type Candle } from "@/lib/indicator/nmnhVision";

// Индикатор переносится с TradingView, поэтому проверяется не «работает ли», а
// «совпадает ли с оригиналом». Ошибка в одной формуле ставит стрелку входа не
// на ту свечу — в торговом инструменте это хуже, чем отсутствие индикатора.

describe("технические функции в семантике Pine", () => {
  it("ema стартует с простой средней за первый период", () => {
    const src = [1, 2, 3, 4, 5];
    const out = ema(src, 3);
    expect(out.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(out[2]).toBe(2); // (1+2+3)/3
    expect(out[3]).toBeCloseTo(4 * 0.5 + 2 * 0.5, 10);
  });

  it("sma считает скользящим окном", () => {
    expect(sma([1, 2, 3, 4], 2)[3]).toBe(3.5);
  });

  it("rma сглаживает по Уайлдеру", () => {
    const out = rma([1, 1, 1, 5], 3);
    expect(out[2]).toBe(1);
    expect(out[3]).toBeCloseTo((1 * 2 + 5) / 3, 10);
  });

  it("rsi отдаёт 100 когда убытков не было", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(rising, 14).at(-1)).toBe(100);
  });

  it("rsi держится в границах 0..100 на пиле", () => {
    const saw = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 1 : -1));
    for (const v of rsi(saw, 14).filter(Number.isFinite)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("trueRange учитывает разрыв от прошлого закрытия", () => {
    // Гэп вверх: диапазон бара 1, но от прошлого закрытия — 6.
    expect(trueRange([110, 111], [109, 110], [109, 110])[1]).toBe(2);
    expect(trueRange([100, 110], [99, 109], [99, 110])[1]).toBe(11);
  });

  it("highest и lowest берут окно вместе с текущим баром", () => {
    expect(highest([1, 5, 3], 2)[2]).toBe(5);
    expect(lowest([1, 5, 3], 2)[2]).toBe(3);
    expect(highest([1, 5, 3], 2)[0]).toBeNaN;
  });

  it("atr не определён, пока не набралась история", () => {
    const h = [2, 2, 2];
    const out = atr(h, [1, 1, 1], [1, 1, 1], 5);
    expect(out.every(Number.isNaN)).toBe(true);
  });
});

// ── свечи для проверки движка ────────────────────────────────────────────────

/** Ряд с разворотом: сначала уверенное падение, затем такой же рост. */
function reversalCandles(): Candle[] {
  const out: Candle[] = [];
  let price = 200;
  for (let i = 0; i < 120; i++) {
    // Первые 60 баров вниз, дальше вверх — Chandelier Exit обязан развернуться.
    price += i < 60 ? -1 : 1.6;
    out.push({
      time: 1_700_000_000 + i * 60,
      open: price - 0.2,
      high: price + 0.5,
      low: price - 0.5,
      close: price,
      volume: 100 + (i % 7) * 20,
    });
  }
  return out;
}

describe("NMNH VISION — сигнальное ядро", () => {
  const candles = reversalCandles();
  const result = computeVision(candles);

  it("значения по умолчанию совпадают с исходником индикатора", () => {
    expect(DEFAULTS.emaFast).toBe(8);
    expect(DEFAULTS.emaSlow).toBe(21);
    expect(DEFAULTS.emaTrend).toBe(50);
    expect(DEFAULTS.ceLength).toBe(22);
    expect(DEFAULTS.ceMult).toBe(3.0);
    expect(DEFAULTS.minScore).toBe(3);
    expect(DEFAULTS.lookback).toBe(1);
    expect(DEFAULTS.useEmaFilter).toBe(true);
    expect(DEFAULTS.rr).toEqual([1.0, 2.0, 3.0]);
  });

  it("скор не выходит за 0..4 — четыре критерия, по баллу за каждый", () => {
    for (const s of [...result.scoreUp, ...result.scoreDown]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(4);
    }
  });

  it("длинный и короткий скоры не бывают максимальными одновременно", () => {
    // Тренд не может быть одновременно вверх и вниз, поэтому сумма ограничена.
    for (let i = 0; i < candles.length; i++) {
      expect(result.scoreUp[i] + result.scoreDown[i]).toBeLessThanOrEqual(4);
    }
  });

  it("Chandelier Exit разворачивается на смене тренда", () => {
    const dirs = new Set(result.direction.slice(30));
    expect(dirs.has(1)).toBe(true);
    expect(dirs.has(-1)).toBe(true);
  });

  it("в устоявшемся тренде стоп идёт по правильную сторону от цены", () => {
    // Считаем, сколько баров направление не менялось: сразу после разворота
    // стоп ещё подтягивается, см. следующую проверку.
    let stable = 0;
    for (let i = 1; i < candles.length; i++) {
      stable = result.direction[i] === result.direction[i - 1] ? stable + 1 : 0;
      if (stable < DEFAULTS.ceLength) continue;

      if (result.direction[i] === 1 && Number.isFinite(result.longStop[i])) {
        expect(result.longStop[i]).toBeLessThan(candles[i].close);
      }
      if (result.direction[i] === -1 && Number.isFinite(result.shortStop[i])) {
        expect(result.shortStop[i]).toBeGreaterThan(candles[i].close);
      }
    }
  });

  it("сразу после разворота стоп может стоять по «неправильную» сторону", () => {
    // Не дефект переноса, а свойство Chandelier Exit: длинный стоп считается
    // как highest(close, 22) − ATR, и первые бары после разворота вверх окно
    // ещё содержит высокие закрытия прошлого падения. Оригинал ведёт себя
    // так же; на графике это выглядит подозрительно, поэтому зафиксировано.
    const flipUp = result.direction.findIndex(
      (d, i) => i > 0 && d === 1 && result.direction[i - 1] === -1,
    );
    expect(flipUp).toBeGreaterThan(0);
    expect(result.longStop[flipUp]).toBeGreaterThan(candles[flipUp].close);
  });

  it("тейки строятся по 1R, 2R, 3R от расстояния до стопа", () => {
    for (const s of result.signals) {
      const risk = Math.abs(s.entry - s.stop);
      const sign = s.side === "buy" ? 1 : -1;
      expect(s.targets[0]).toBeCloseTo(s.entry + sign * risk * 1, 8);
      expect(s.targets[1]).toBeCloseTo(s.entry + sign * risk * 2, 8);
      expect(s.targets[2]).toBeCloseTo(s.entry + sign * risk * 3, 8);
    }
  });

  it("стоп покупки всегда ниже входа, продажи — выше", () => {
    for (const s of result.signals) {
      if (s.side === "buy") expect(s.stop).toBeLessThan(s.entry);
      else expect(s.stop).toBeGreaterThan(s.entry);
    }
  });

  it("фильтр EMA50 отсекает покупки под трендовой", () => {
    for (const s of result.signals) {
      const trend = result.emaTrend[s.index];
      if (s.side === "buy") expect(s.entry).toBeGreaterThan(trend);
      else expect(s.entry).toBeLessThan(trend);
    }
  });

  it("без фильтра EMA50 сигналов не меньше, чем с ним", () => {
    const loose = computeVision(candles, { useEmaFilter: false });
    expect(loose.signals.length).toBeGreaterThanOrEqual(result.signals.length);
  });

  it("порог скора 4 из 4 строже, чем 1 из 4", () => {
    const strict = computeVision(candles, { minScore: 4 });
    const loose = computeVision(candles, { minScore: 1 });
    expect(strict.signals.length).toBeLessThanOrEqual(loose.signals.length);
  });

  it("сигнал возникает только на развороте Chandelier Exit", () => {
    for (const s of result.signals) {
      const flipped =
        result.direction[s.index] !== result.direction[s.index - 1];
      expect(flipped).toBe(true);
    }
  });

  it("пустой и короткий ввод не роняют движок", () => {
    expect(computeVision([]).signals).toEqual([]);
    expect(computeVision(candles.slice(0, 3)).signals).toEqual([]);
  });

  it("инструмент без объёма не ломает скоринг", () => {
    const noVolume = candles.map((c) => ({ ...c, volume: 0 }));
    const out = computeVision(noVolume);
    expect(out.scoreUp.every((s) => s >= 0 && s <= 4)).toBe(true);
  });
});
