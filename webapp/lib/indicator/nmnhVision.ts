// NMNH VISION — сигнальное ядро индикатора, перенесённое с Pine Script v6.
//
// Перенесены три блока оригинала: BM Score (оценка условий по четырём
// критериям), Chandelier Exit (трейлинг-стоп на ATR) и их объединение в
// торговый сигнал. Структурная часть индикатора — BOS/CHoCH, ордер-блоки,
// FVG — сюда не входит, она переносится отдельно.
//
// Значения по умолчанию взяты из исходника, а не подобраны: EMA 8/21/50,
// RSI 14 с зонами 35/65, объёмный осциллятор 5/14 против своей SMA 10,
// ATR 22 с множителем 3.0, порог скора 3 из 4, окно подтверждения 1 бар,
// фильтр по EMA50 включён, тейки по 1R/2R/3R.
//
// Важная деталь переноса: Chandelier Exit считается от `highest(close)` и
// `lowest(close)`, а не от максимумов и минимумов баров. На развороте это
// заметно разные уровни, и стоп встал бы не туда.

import { atr, ema, highest, lowest, nz, rsi, sma } from "./ta";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type VisionOptions = {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  rsiLength: number;
  rsiLowZone: number;
  rsiHighZone: number;
  voFast: number;
  voSlow: number;
  voSmaLength: number;
  ceLength: number;
  ceMult: number;
  minScore: number;
  lookback: number;
  useEmaFilter: boolean;
  rr: [number, number, number];
};

export const DEFAULTS: VisionOptions = {
  emaFast: 8,
  emaSlow: 21,
  emaTrend: 50,
  rsiLength: 14,
  rsiLowZone: 35,
  rsiHighZone: 65,
  voFast: 5,
  voSlow: 14,
  voSmaLength: 10,
  ceLength: 22,
  ceMult: 3.0,
  minScore: 3,
  lookback: 1,
  useEmaFilter: true,
  rr: [1.0, 2.0, 3.0],
};

/** Сделка, предложенная сигналом: вход, стоп от CE и три тейка по RR. */
export type VisionSignal = {
  index: number;
  time: number;
  side: "buy" | "sell";
  entry: number;
  stop: number;
  targets: [number, number, number];
  score: number;
};

export type VisionResult = {
  emaFast: number[];
  emaSlow: number[];
  emaTrend: number[];
  rsi: number[];
  vo: number[];
  voSma: number[];
  scoreUp: number[];
  scoreDown: number[];
  /** Уровень трейлинг-стопа; NaN там, где сторона неактивна. */
  longStop: number[];
  shortStop: number[];
  /** Направление Chandelier Exit: +1 вверх, −1 вниз. */
  direction: number[];
  signals: VisionSignal[];
};

export function computeVision(
  candles: Candle[],
  options: Partial<VisionOptions> = {},
): VisionResult {
  const o = { ...DEFAULTS, ...options };
  const n = candles.length;

  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  // nz(volume, 1.0) — на инструментах без объёма осциллятор обнуляется,
  // а не ломает весь скоринг.
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

  const scoreUp = new Array<number>(n).fill(0);
  const scoreDown = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
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
    scoreUp[i] = Number(trendUp) + Number(crossUp) + Number(rsiUp) + Number(volUp);

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
    scoreDown[i] = Number(trendDn) + Number(crossDn) + Number(rsiDn) + Number(volDn);
  }

  // ── Chandelier Exit ───────────────────────────────────────────────────────
  const atrSeries = atr(high, low, close, o.ceLength);
  const highestClose = highest(close, o.ceLength);
  const lowestClose = lowest(close, o.ceLength);

  const longStop = new Array<number>(n).fill(Number.NaN);
  const shortStop = new Array<number>(n).fill(Number.NaN);
  const direction = new Array<number>(n).fill(1);

  let prevLong = Number.NaN;
  let prevShort = Number.NaN;
  let dir = 1;

  for (let i = 0; i < n; i++) {
    const band = o.ceMult * atrSeries[i];
    if (!Number.isFinite(band)) {
      direction[i] = dir;
      continue;
    }

    // Стоп подтягивается только пока прошлое закрытие держалось выше него.
    let lStop = highestClose[i] - band;
    const lPrev = nz(prevLong, lStop);
    if (i > 0 && close[i - 1] > lPrev) lStop = Math.max(lStop, lPrev);

    let sStop = lowestClose[i] + band;
    const sPrev = nz(prevShort, sStop);
    if (i > 0 && close[i - 1] < sPrev) sStop = Math.min(sStop, sPrev);

    // Направление меняется по пробою противоположного стопа прошлого бара.
    dir = close[i] > sPrev ? 1 : close[i] < lPrev ? -1 : dir;

    longStop[i] = lStop;
    shortStop[i] = sStop;
    direction[i] = dir;
    prevLong = lStop;
    prevShort = sStop;
  }

  // ── Объединённый сигнал ───────────────────────────────────────────────────
  const signals: VisionSignal[] = [];
  const bestUp = highest(scoreUp, o.lookback);
  const bestDown = highest(scoreDown, o.lookback);

  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(longStop[i]) || !Number.isFinite(shortStop[i])) continue;

    const flippedUp = direction[i] === 1 && direction[i - 1] === -1;
    const flippedDown = direction[i] === -1 && direction[i - 1] === 1;
    if (!flippedUp && !flippedDown) continue;

    const emaOk = !o.useEmaFilter
      ? true
      : flippedUp
        ? close[i] > trend[i]
        : close[i] < trend[i];
    if (!emaOk || !Number.isFinite(trend[i])) continue;

    const scoreOk = flippedUp
      ? bestUp[i] >= o.minScore
      : bestDown[i] >= o.minScore;
    if (!scoreOk) continue;

    const entry = close[i];
    const stop = flippedUp ? longStop[i] : shortStop[i];
    const distance = Math.abs(entry - stop);
    const sign = flippedUp ? 1 : -1;

    signals.push({
      index: i,
      time: candles[i].time,
      side: flippedUp ? "buy" : "sell",
      entry,
      stop,
      targets: [
        entry + sign * distance * o.rr[0],
        entry + sign * distance * o.rr[1],
        entry + sign * distance * o.rr[2],
      ],
      score: flippedUp ? scoreUp[i] : scoreDown[i],
    });
  }

  return {
    emaFast: fast,
    emaSlow: slow,
    emaTrend: trend,
    rsi: rsiSeries,
    vo,
    voSma,
    scoreUp,
    scoreDown,
    longStop,
    shortStop,
    direction,
    signals,
  };
}
