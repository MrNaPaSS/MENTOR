// Показания индикатора для панели в углу графика: балл Black Mirror и объём.
//
// Это возвращённая часть слоя VISION, убранного целиком в 936f706. Возвращена
// именно часть: рисование - коридор, метки, линии стопа - закрашивало график
// так, что свечей не было видно, и убрали его не случайно. А четыре числа,
// по которым читается сила движения, к рисованию отношения не имеют.
//
// Формулы те же, что были там, и те же, что в оригинальном индикаторе на
// TradingView. Менять их здесь нельзя: панель на сайте обязана показывать то же
// самое, что панель на графике у того, кто смотрит оригинал.

import { ema, nz, rsi, sma } from "./ta";
import type { Candle } from "./types";

export type ScoreOptions = {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  rsiLength: number;
  rsiLowZone: number;
  rsiHighZone: number;
  voFast: number;
  voSlow: number;
  voSmaLength: number;
};

export const SCORE_DEFAULTS: ScoreOptions = {
  emaFast: 8,
  emaSlow: 21,
  emaTrend: 50,
  rsiLength: 14,
  rsiLowZone: 35,
  rsiHighZone: 65,
  voFast: 5,
  voSlow: 14,
  voSmaLength: 10,
};

/** Показания на последней свече - то, что стоит в панели. */
export type ScoreReadout = {
  /** Балл в сторону покупки, от нуля до четырёх. */
  long: number;
  /** Балл в сторону продажи, от нуля до четырёх. */
  short: number;
  /** Осциллятор объёма в процентах. NaN - объёма у инструмента нет. */
  vo: number;
  /** Его скользящая средняя. */
  voSma: number;
};

const EMPTY: ScoreReadout = { long: 0, short: 0, vo: Number.NaN, voSma: Number.NaN };

/**
 * Балл и объём на последней свече.
 *
 * Балл складывается из четырёх независимых условий, каждое ценой в единицу:
 * тренд, пересечение средних, выход RSI из зоны и объём выше своей средней.
 * Складываются они, а не перемножаются, намеренно - три условия из четырёх
 * это сильное движение, а не отсутствие сигнала.
 */
export function readout(candles: Candle[], options: Partial<ScoreOptions> = {}): ScoreReadout {
  const o = { ...SCORE_DEFAULTS, ...options };
  const n = candles.length;
  // Двух свечей мало на любую среднюю: показывать по ним балл значит показывать
  // ноль и выдавать его за спокойный рынок.
  if (n < o.emaTrend) return EMPTY;

  const close = candles.map((c) => c.close);
  // Без объёма осциллятор обнуляется, а не ломает весь счёт.
  const volume = candles.map((c) => nz(c.volume, 1.0));

  const fast = ema(close, o.emaFast);
  const slow = ema(close, o.emaSlow);
  const trend = ema(close, o.emaTrend);
  const rsiSeries = rsi(close, o.rsiLength);

  const volFast = ema(volume, o.voFast);
  const volSlow = ema(volume, o.voSlow);
  const vo = volFast.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(volSlow[i]) && volSlow[i] !== 0
      ? ((v - volSlow[i]) / volSlow[i]) * 100
      : Number.NaN,
  );
  const voSma = sma(vo, o.voSmaLength);

  const i = n - 1;
  const p = i - 1;
  const has = (v: number) => Number.isFinite(v);

  const trendUp = has(fast[i]) && has(trend[i]) && fast[i] > slow[i] && close[i] > trend[i];
  const crossUp = p >= 0 && has(fast[p]) && fast[i] > slow[i] && fast[p] <= slow[p];
  const rsiUp =
    has(rsiSeries[i]) &&
    ((p >= 0 &&
      has(rsiSeries[p]) &&
      rsiSeries[i] > o.rsiLowZone &&
      rsiSeries[p] <= o.rsiLowZone) ||
      (rsiSeries[i] > o.rsiLowZone && p >= 0 && rsiSeries[i] > rsiSeries[p]));
  const volUp = has(vo[i]) && has(voSma[i]) && vo[i] > 0 && vo[i] > voSma[i];

  const trendDn = has(fast[i]) && has(trend[i]) && fast[i] < slow[i] && close[i] < trend[i];
  const crossDn = p >= 0 && has(fast[p]) && fast[i] < slow[i] && fast[p] >= slow[p];
  const rsiDn =
    has(rsiSeries[i]) &&
    ((p >= 0 &&
      has(rsiSeries[p]) &&
      rsiSeries[i] < o.rsiHighZone &&
      rsiSeries[p] >= o.rsiHighZone) ||
      (rsiSeries[i] < o.rsiHighZone && p >= 0 && rsiSeries[i] < rsiSeries[p]));
  const volDn = has(vo[i]) && has(voSma[i]) && vo[i] < 0 && vo[i] < voSma[i];

  return {
    long: Number(trendUp) + Number(crossUp) + Number(rsiUp) + Number(volUp),
    short: Number(trendDn) + Number(crossDn) + Number(rsiDn) + Number(volDn),
    vo: vo[i],
    voSma: voSma[i],
  };
}

/** Число для панели: одна десятая и прочерк вместо пустоты. */
export function tenth(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}
