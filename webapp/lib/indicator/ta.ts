// Технические функции в семантике Pine Script.
//
// Индикатор переносится с TradingView, поэтому функции повторяют поведение
// `ta.*` буквально, включая то, как они ведут себя на первых барах. Расхождение
// в одной формуле здесь означает, что стрелка входа встанет не на ту свечу, —
// поэтому никаких «примерно так же».
//
// Все функции возвращают массив той же длины, что и вход; там, где значение
// ещё не определено (не хватает истории), стоит NaN — как `na` в Pine.

/** ta.ema: экспоненциальная средняя, стартует с SMA за первый период. */
export function ema(source: number[], length: number): number[] {
  const out = new Array<number>(source.length).fill(Number.NaN);
  if (length <= 0 || source.length < length) return out;

  const k = 2 / (length + 1);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += source[i];
  let prev = sum / length;
  out[length - 1] = prev;

  for (let i = length; i < source.length; i++) {
    prev = source[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** ta.sma: простая средняя скользящим окном. */
export function sma(source: number[], length: number): number[] {
  const out = new Array<number>(source.length).fill(Number.NaN);
  if (length <= 0) return out;

  let sum = 0;
  for (let i = 0; i < source.length; i++) {
    sum += source[i];
    if (i >= length) sum -= source[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/** ta.rma: сглаживание Уайлдера — на нём построены RSI и ATR. */
export function rma(source: number[], length: number): number[] {
  const out = new Array<number>(source.length).fill(Number.NaN);
  if (length <= 0 || source.length < length) return out;

  let sum = 0;
  for (let i = 0; i < length; i++) sum += source[i];
  let prev = sum / length;
  out[length - 1] = prev;

  for (let i = length; i < source.length; i++) {
    prev = (prev * (length - 1) + source[i]) / length;
    out[i] = prev;
  }
  return out;
}

/** ta.rsi: относительная сила по Уайлдеру. */
export function rsi(source: number[], length: number): number[] {
  const gains = new Array<number>(source.length).fill(0);
  const losses = new Array<number>(source.length).fill(0);
  for (let i = 1; i < source.length; i++) {
    const change = source[i] - source[i - 1];
    gains[i] = change > 0 ? change : 0;
    losses[i] = change < 0 ? -change : 0;
  }
  // Первый бар не участвует: изменения на нём нет, как и в Pine.
  const avgGain = rma(gains.slice(1), length);
  const avgLoss = rma(losses.slice(1), length);

  const out = new Array<number>(source.length).fill(Number.NaN);
  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (Number.isNaN(g) || Number.isNaN(l)) continue;
    // Убытков нет — сила максимальна; роста нет — минимальна.
    out[i + 1] = l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** True Range: размах бара с учётом разрыва от предыдущего закрытия. */
export function trueRange(high: number[], low: number[], close: number[]): number[] {
  const out = new Array<number>(high.length).fill(Number.NaN);
  if (high.length === 0) return out;
  out[0] = high[0] - low[0];
  for (let i = 1; i < high.length; i++) {
    out[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
    );
  }
  return out;
}

/** ta.atr: средний истинный диапазон. */
export function atr(high: number[], low: number[], close: number[], length: number): number[] {
  return rma(trueRange(high, low, close), length);
}

/** ta.highest: максимум за `length` баров, включая текущий. */
export function highest(source: number[], length: number): number[] {
  return rolling(source, length, Math.max);
}

/** ta.lowest: минимум за `length` баров, включая текущий. */
export function lowest(source: number[], length: number): number[] {
  return rolling(source, length, Math.min);
}

function rolling(
  source: number[],
  length: number,
  pick: (a: number, b: number) => number,
): number[] {
  const out = new Array<number>(source.length).fill(Number.NaN);
  if (length <= 0) return out;
  for (let i = 0; i < source.length; i++) {
    if (i < length - 1) continue;
    let value = source[i];
    for (let j = i - length + 1; j < i; j++) value = pick(value, source[j]);
    out[i] = value;
  }
  return out;
}

/** ta.crossover: серия пересекла уровень снизу вверх на этом баре. */
export function crossedOver(current: number, previous: number, level: number, prevLevel: number) {
  return current > level && previous <= prevLevel;
}

/** ta.crossunder: серия пересекла уровень сверху вниз на этом баре. */
export function crossedUnder(current: number, previous: number, level: number, prevLevel: number) {
  return current < level && previous >= prevLevel;
}

/** nz: заменить NaN на запасное значение, как `nz()` в Pine. */
export function nz(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}
