// NMNH VISION — структурная часть индикатора, перенесённая с Pine Script v6.
//
// Здесь то, что рисуется на графике поверх свечей: структура рынка (BOS и
// CHoCH на двух масштабах), точки свингов, ордер-блоки, разрывы справедливой
// цены, равные экстремумы и зоны премии/скидки.
//
// Движок повторяет исполнение Pine бар за баром: состояние пивотов, флаги
// «уровень уже пробит», накопление и погашение блоков. Иначе структуру не
// воспроизвести — она вся построена на памяти о прошлых барах, а не на формуле
// от текущего.
//
// Значения по умолчанию взяты из рабочего пространства заказчика, а не из
// исходника: у него ордер-блоков 3 и 2, а не 5 и 5, и FVG продлевается на 20
// баров, а не на один.

import { atr } from "./ta";
import type { Candle } from "./nmnhVision";

export const BULLISH = 1;
export const BEARISH = -1;

export type Bias = typeof BULLISH | typeof BEARISH;

export type SmcOptions = {
  swingLength: number;
  internalLength: number;
  equalLength: number;
  equalThreshold: number;
  internalOrderBlocks: number;
  swingOrderBlocks: number;
  orderBlockFilter: "atr" | "range";
  orderBlockMitigation: "close" | "highlow";
  confluenceFilter: boolean;
  fvgExtendBars: number;
  fvgAutoThreshold: boolean;
};

export const SMC_DEFAULTS: SmcOptions = {
  swingLength: 50,
  internalLength: 5,
  equalLength: 3,
  equalThreshold: 0.1,
  internalOrderBlocks: 3,
  swingOrderBlocks: 2,
  orderBlockFilter: "atr",
  orderBlockMitigation: "highlow",
  confluenceFilter: true,
  fvgExtendBars: 20,
  fvgAutoThreshold: true,
};

/** Линия структуры: от пивота до бара, на котором его пробили. */
export type StructureLine = {
  fromTime: number;
  toTime: number;
  price: number;
  tag: "BOS" | "CHoCH";
  bias: Bias;
  internal: boolean;
};

export type SwingLabel = {
  time: number;
  price: number;
  tag: "HH" | "LH" | "HL" | "LL";
};

export type OrderBlockBox = {
  top: number;
  bottom: number;
  fromTime: number;
  bias: Bias;
  internal: boolean;
};

export type FvgBox = {
  top: number;
  bottom: number;
  fromTime: number;
  toTime: number;
  bias: Bias;
};

export type EqualLine = {
  fromTime: number;
  toTime: number;
  price: number;
  tag: "EQH" | "EQL";
};

export type Trailing = {
  top: number;
  bottom: number;
  topTime: number;
  bottomTime: number;
  /** Сильный максимум — когда свинг-тренд направлен вниз, и наоборот. */
  strongHigh: boolean;
  strongLow: boolean;
};

export type Zone = { top: number; bottom: number; tag: string };

export type SmcResult = {
  structures: StructureLine[];
  swings: SwingLabel[];
  orderBlocks: OrderBlockBox[];
  fvgs: FvgBox[];
  equals: EqualLine[];
  trailing: Trailing | null;
  zones: Zone[];
  bias: { swing: number; internal: number };
};

type Pivot = {
  currentLevel: number;
  lastLevel: number;
  crossed: boolean;
  barTime: number;
  barIndex: number;
};

function emptyPivot(): Pivot {
  return {
    currentLevel: Number.NaN,
    lastLevel: Number.NaN,
    crossed: false,
    barTime: 0,
    barIndex: 0,
  };
}

type StoredBlock = {
  barHigh: number;
  barLow: number;
  barTime: number;
  bias: Bias;
};

export function computeSmc(
  candles: Candle[],
  options: Partial<SmcOptions> = {},
): SmcResult {
  const o = { ...SMC_DEFAULTS, ...options };
  const n = candles.length;

  const empty: SmcResult = {
    structures: [],
    swings: [],
    orderBlocks: [],
    fvgs: [],
    equals: [],
    trailing: null,
    zones: [],
    bias: { swing: 0, internal: 0 },
  };
  if (n === 0) return empty;

  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);
  const open = candles.map((c) => c.open);
  const time = candles.map((c) => c.time);

  // Волатильность: по ней отбраковываются широкие бары и меряется порог
  // равенства экстремумов. В оригинале это ATR за 200 баров.
  const atr200 = atr(high, low, close, 200);
  const cumulativeTr: number[] = [];
  {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const tr =
        i === 0
          ? high[i] - low[i]
          : Math.max(
              high[i] - low[i],
              Math.abs(high[i] - close[i - 1]),
              Math.abs(low[i] - close[i - 1]),
            );
      sum += tr;
      cumulativeTr.push(i === 0 ? tr : sum / i);
    }
  }

  // На широком баре максимум и минимум меняются местами. Приём из оригинала:
  // ордер-блок на выбросе волатильности иначе растягивается на весь бар и
  // перестаёт быть уровнем.
  const parsedHigh: number[] = [];
  const parsedLow: number[] = [];
  for (let i = 0; i < n; i++) {
    const measure = o.orderBlockFilter === "atr" ? atr200[i] : cumulativeTr[i];
    const wide = Number.isFinite(measure) && high[i] - low[i] >= 2 * measure;
    parsedHigh.push(wide ? low[i] : high[i]);
    parsedLow.push(wide ? high[i] : low[i]);
  }

  const swingHigh = emptyPivot();
  const swingLow = emptyPivot();
  const internalHigh = emptyPivot();
  const internalLow = emptyPivot();
  const equalHigh = emptyPivot();
  const equalLow = emptyPivot();

  let swingBias = 0;
  let internalBias = 0;

  const legState = { swing: 0, internal: 0, equal: 0 };

  const trailing: Trailing = {
    top: Number.NaN,
    bottom: Number.NaN,
    topTime: 0,
    bottomTime: 0,
    strongHigh: false,
    strongLow: false,
  };

  const structures: StructureLine[] = [];
  const swings: SwingLabel[] = [];
  const equals: EqualLine[] = [];
  let swingBlocks: StoredBlock[] = [];
  let internalBlocks: StoredBlock[] = [];
  let fvgs: FvgBox[] = [];

  /** Значение «ноги» по правилам оригинала: 1 — бычья, 0 — медвежья. */
  function legAt(i: number, size: number, previous: number): number {
    if (i - size < 0) return previous;
    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (let j = i - size + 1; j <= i; j++) {
      maxHigh = Math.max(maxHigh, high[j]);
      minLow = Math.min(minLow, low[j]);
    }
    if (high[i - size] > maxHigh) return 0;
    if (low[i - size] < minLow) return 1;
    return previous;
  }

  function storeBlock(pivot: Pivot, i: number, internal: boolean, bias: Bias) {
    const from = pivot.barIndex;
    if (!Number.isFinite(from) || from >= i) return;

    // Блок ставится на самый крайний бар между пивотом и пробоем: для бычьего
    // пробоя это самый низкий бар, для медвежьего — самый высокий.
    let bestIndex = from;
    for (let j = from; j < i; j++) {
      if (bias === BEARISH ? parsedHigh[j] > parsedHigh[bestIndex] : parsedLow[j] < parsedLow[bestIndex]) {
        bestIndex = j;
      }
    }

    const block: StoredBlock = {
      barHigh: parsedHigh[bestIndex],
      barLow: parsedLow[bestIndex],
      barTime: time[bestIndex],
      bias,
    };
    const list = internal ? internalBlocks : swingBlocks;
    list.unshift(block);
    if (list.length > 100) list.pop();
  }

  function detectStructure(i: number, internal: boolean) {
    const pivotHigh = internal ? internalHigh : swingHigh;
    const pivotLow = internal ? internalLow : swingLow;

    // Фильтр конфлюенса: внутренний пробой учитывается только если бар
    // «правильной» формы. Формула перенесена из исходника буквально, включая
    // math.min(close, open - low) — она в нём именно такая.
    let bullishBar = true;
    let bearishBar = true;
    if (o.confluenceFilter) {
      const upper = high[i] - Math.max(close[i], open[i]);
      const other = Math.min(close[i], open[i] - low[i]);
      bullishBar = upper > other;
      bearishBar = upper < other;
    }

    const prevClose = i > 0 ? close[i - 1] : close[i];

    const upExtra = internal
      ? internalHigh.currentLevel !== swingHigh.currentLevel && bullishBar
      : true;
    if (
      Number.isFinite(pivotHigh.currentLevel) &&
      close[i] > pivotHigh.currentLevel &&
      prevClose <= pivotHigh.currentLevel &&
      !pivotHigh.crossed &&
      upExtra
    ) {
      const bias = internal ? internalBias : swingBias;
      const tag = bias === BEARISH ? "CHoCH" : "BOS";
      structures.push({
        fromTime: pivotHigh.barTime,
        toTime: time[i],
        price: pivotHigh.currentLevel,
        tag,
        bias: BULLISH,
        internal,
      });
      pivotHigh.crossed = true;
      if (internal) internalBias = BULLISH;
      else swingBias = BULLISH;
      storeBlock(pivotHigh, i, internal, BULLISH);
    }

    const downExtra = internal
      ? internalLow.currentLevel !== swingLow.currentLevel && bearishBar
      : true;
    if (
      Number.isFinite(pivotLow.currentLevel) &&
      close[i] < pivotLow.currentLevel &&
      prevClose >= pivotLow.currentLevel &&
      !pivotLow.crossed &&
      downExtra
    ) {
      const bias = internal ? internalBias : swingBias;
      const tag = bias === BULLISH ? "CHoCH" : "BOS";
      structures.push({
        fromTime: pivotLow.barTime,
        toTime: time[i],
        price: pivotLow.currentLevel,
        tag,
        bias: BEARISH,
        internal,
      });
      pivotLow.crossed = true;
      if (internal) internalBias = BEARISH;
      else swingBias = BEARISH;
      storeBlock(pivotLow, i, internal, BEARISH);
    }
  }

  function updatePivots(i: number, size: number, kind: "swing" | "internal" | "equal") {
    const previous = legState[kind];
    const current = legAt(i, size, previous);
    legState[kind] = current;
    if (current === previous || i - size < 0) return;

    const newLow = current === 1;
    const pivot = newLow
      ? kind === "equal"
        ? equalLow
        : kind === "internal"
          ? internalLow
          : swingLow
      : kind === "equal"
        ? equalHigh
        : kind === "internal"
          ? internalHigh
          : swingHigh;

    const level = newLow ? low[i - size] : high[i - size];

    if (kind === "equal" && Number.isFinite(pivot.currentLevel)) {
      const threshold = o.equalThreshold * (atr200[i] || 0);
      if (threshold > 0 && Math.abs(pivot.currentLevel - level) < threshold) {
        equals.push({
          fromTime: pivot.barTime,
          toTime: time[i - size],
          price: level,
          tag: newLow ? "EQL" : "EQH",
        });
      }
    }

    pivot.lastLevel = pivot.currentLevel;
    pivot.currentLevel = level;
    pivot.crossed = false;
    pivot.barTime = time[i - size];
    pivot.barIndex = i - size;

    if (kind === "swing") {
      if (newLow) {
        trailing.bottom = level;
        trailing.bottomTime = pivot.barTime;
      } else {
        trailing.top = level;
        trailing.topTime = pivot.barTime;
      }
      // Первый свинг тоже подписывается. Сравнивать его не с чем, и сравнение
      // с пустым значением даёт «ложь» — как в оригинале, где первая вершина
      // выходит LH, а первая впадина HL.
      swings.push({
        time: pivot.barTime,
        price: level,
        tag: newLow
          ? level < pivot.lastLevel
            ? "LL"
            : "HL"
          : level > pivot.lastLevel
            ? "HH"
            : "LH",
      });
    }
  }

  for (let i = 0; i < n; i++) {
    // Порядок повторяет исполнение оригинала: сначала бегущие экстремумы,
    // затем структура, затем погашение блоков и разрывов.
    if (!Number.isFinite(trailing.top) || high[i] > trailing.top) {
      trailing.top = high[i];
      trailing.topTime = time[i];
    }
    if (!Number.isFinite(trailing.bottom) || low[i] < trailing.bottom) {
      trailing.bottom = low[i];
      trailing.bottomTime = time[i];
    }

    // Разрыв закрыт, когда цена вернулась в него.
    fvgs = fvgs.filter(
      (g) => !((low[i] < g.bottom && g.bias === BULLISH) || (high[i] > g.top && g.bias === BEARISH)),
    );

    updatePivots(i, o.swingLength, "swing");
    updatePivots(i, o.internalLength, "internal");
    updatePivots(i, o.equalLength, "equal");

    detectStructure(i, true);
    detectStructure(i, false);

    // Погашение блоков: цена прошла уровень насквозь.
    const upSource = o.orderBlockMitigation === "close" ? close[i] : low[i];
    const downSource = o.orderBlockMitigation === "close" ? close[i] : high[i];
    const alive = (b: StoredBlock) =>
      b.bias === BEARISH ? !(downSource > b.barHigh) : !(upSource < b.barLow);
    internalBlocks = internalBlocks.filter(alive);
    swingBlocks = swingBlocks.filter(alive);

    // Разрывы справедливой цены: тело позапрошлого бара не перекрыто.
    if (i >= 2) {
      const delta = (close[i - 1] - open[i - 1]) / (open[i - 1] * 100);
      const threshold = o.fvgAutoThreshold ? averageDelta(i) : 0;
      const step = i > 0 ? time[i] - time[i - 1] : 0;
      const until = time[i] + o.fvgExtendBars * step;

      if (low[i] > high[i - 2] && close[i - 1] > high[i - 2] && delta > threshold) {
        fvgs.unshift({
          top: low[i],
          bottom: high[i - 2],
          fromTime: time[i - 1],
          toTime: until,
          bias: BULLISH,
        });
      }
      if (high[i] < low[i - 2] && close[i - 1] < low[i - 2] && -delta > threshold) {
        fvgs.unshift({
          top: high[i],
          bottom: low[i - 2],
          fromTime: time[i - 1],
          toTime: until,
          bias: BEARISH,
        });
      }
    }
  }

  /** Средний размах тела за всю историю, удвоенный — порог значимости разрыва. */
  function averageDelta(i: number): number {
    let sum = 0;
    for (let j = 1; j <= i; j++) {
      sum += Math.abs((close[j - 1] - open[j - 1]) / (open[j - 1] * 100));
    }
    return i > 0 ? (sum / i) * 2 : 0;
  }

  trailing.strongHigh = swingBias === BEARISH;
  trailing.strongLow = swingBias === BULLISH;

  const zones: Zone[] = [];
  if (Number.isFinite(trailing.top) && Number.isFinite(trailing.bottom)) {
    const { top, bottom } = trailing;
    zones.push({ top, bottom: 0.95 * top + 0.05 * bottom, tag: "Premium" });
    zones.push({
      top: 0.525 * top + 0.475 * bottom,
      bottom: 0.525 * bottom + 0.475 * top,
      tag: "Equilibrium",
    });
    zones.push({ top: 0.95 * bottom + 0.05 * top, bottom, tag: "Discount" });
  }

  const takeBlocks = (list: StoredBlock[], limit: number, internal: boolean) =>
    list.slice(0, limit).map((b) => ({
      top: b.barHigh,
      bottom: b.barLow,
      fromTime: b.barTime,
      bias: b.bias,
      internal,
    }));

  return {
    structures,
    swings,
    orderBlocks: [
      ...takeBlocks(internalBlocks, o.internalOrderBlocks, true),
      ...takeBlocks(swingBlocks, o.swingOrderBlocks, false),
    ],
    fvgs,
    equals,
    trailing,
    zones,
    bias: { swing: swingBias, internal: internalBias },
  };
}
