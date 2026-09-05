// Трейлинг-уровень Chandelier Exit из индикатора.
//
// В скрипте это линия стопа, но на графике она работает как динамический
// уровень: пока цена выше — уровень держит снизу и подтягивается за ростом,
// сломался — направление сменилось, и уровень переехал наверх. Заливка между
// ним и средней ценой бара показывает, в какую сторону сейчас смещение.
//
// Порт дословный, включая порядок сравнений с предыдущим значением: в Pine
// `longStop` пересчитывается из своего же прошлого значения, и если сравнить
// не с ним, а с текущим, уровень начнёт съезжать вниз на каждом баре.

import { atr as atrSeries } from "./ta";
import type { Candle } from "./types";

export type Direction = 1 | -1;

export type ChandelierBar = {
  time: number;
  /** Уровень поддержки при росте. */
  longStop: number;
  /** Уровень сопротивления при падении. */
  shortStop: number;
  dir: Direction;
  /** Средняя цена бара — вторая граница заливки. */
  mid: number;
};

export type ChandelierSignal = {
  time: number;
  price: number;
  dir: Direction;
};

export type ChandelierResult = {
  bars: ChandelierBar[];
  /** Развороты уровня: BY↑ на смене вверх, SL↓ на смене вниз. */
  signals: ChandelierSignal[];
};

/** ATR Period и ATR Multiplier из настроек скрипта. */
export const CE_LENGTH = 22;
export const CE_MULT = 3.0;

/** Наибольшее закрытие за окно — как ta.highest(close, len). */
function highestClose(close: number[], index: number, length: number): number {
  let out = -Infinity;
  for (let i = Math.max(0, index - length + 1); i <= index; i++) {
    if (close[i] > out) out = close[i];
  }
  return out;
}

function lowestClose(close: number[], index: number, length: number): number {
  let out = Infinity;
  for (let i = Math.max(0, index - length + 1); i <= index; i++) {
    if (close[i] < out) out = close[i];
  }
  return out;
}

export function computeChandelier(
  candles: Candle[],
  length = CE_LENGTH,
  mult = CE_MULT,
): ChandelierResult {
  const bars: ChandelierBar[] = [];
  const signals: ChandelierSignal[] = [];
  if (candles.length === 0) return { bars, signals };

  const close = candles.map((c) => c.close);
  const atr = atrSeries(
    candles.map((c) => c.high),
    candles.map((c) => c.low),
    close,
    length,
  );

  let prevLong = NaN;
  let prevShort = NaN;
  let dir: Direction = 1;

  for (let i = 0; i < candles.length; i++) {
    const band = mult * atr[i];
    if (!Number.isFinite(band)) continue;

    let longStop = highestClose(close, i, length) - band;
    let shortStop = lowestClose(close, i, length) + band;

    // nz(longStop[1], longStop): на первом рассчитанном баре прошлого нет.
    const prevLongOr = Number.isFinite(prevLong) ? prevLong : longStop;
    const prevShortOr = Number.isFinite(prevShort) ? prevShort : shortStop;

    // Уровень только подтягивается за ценой и никогда не отступает назад,
    // пока направление держится.
    if (i > 0 && close[i - 1] > prevLongOr) longStop = Math.max(longStop, prevLongOr);
    if (i > 0 && close[i - 1] < prevShortOr) shortStop = Math.min(shortStop, prevShortOr);

    const previous: Direction = dir;
    // Сравнение с прошлым значением, а не с текущим: направление меняется по
    // пробою уровня, который стоял на момент открытия бара.
    if (close[i] > prevShortOr) dir = 1;
    else if (close[i] < prevLongOr) dir = -1;

    if (bars.length > 0 && dir !== previous) {
      signals.push({
        time: candles[i].time,
        price: dir === 1 ? longStop : shortStop,
        dir,
      });
    }

    bars.push({
      time: candles[i].time,
      longStop,
      shortStop,
      dir,
      // ohlc4 из скрипта: заливка идёт от уровня до середины бара.
      mid: (candles[i].open + candles[i].high + candles[i].low + candles[i].close) / 4,
    });

    prevLong = longStop;
    prevShort = shortStop;
  }

  return { bars, signals };
}

/** Текущий уровень: то, что на графике держит цену снизу или сверху. */
export function activeLevel(bar: ChandelierBar): number {
  return bar.dir === 1 ? bar.longStop : bar.shortStop;
}
