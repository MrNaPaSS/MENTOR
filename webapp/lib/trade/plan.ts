// Расчёт сделки от уровня.
//
// Чистые функции без React и без графика: трейдер вводит сумму, плечо и стоп,
// а всё остальное считается отсюда. Вынесено отдельным файлом именно ради
// тестов — в деньгах ошибаться нельзя, а глазами такие формулы не проверишь.
//
// Единица риска здесь — R, расстояние от входа до стопа. Тейки задаются в R,
// а не в процентах цены: соотношение риска к прибыли — это то, по чему сделку
// оценивают, и оно должно быть видно прямо в цифрах целей.

export type TradeSide = "long" | "short";

export type TradeInput = {
  /** Цена входа — цена полки. */
  entry: number;
  side: TradeSide;
  /** Стоп в процентах от цены входа. */
  stopPct: number;
  /** Маржа: сколько своих денег трейдер кладёт в сделку. */
  margin: number;
  leverage: number;
  /** Цели в R. */
  takes: number[];
};

export type TradeTarget = {
  r: number;
  price: number;
  /** Прибыль в деньгах, если закрыть всю позицию на этой цели. */
  profit: number;
};

export type TradePlan = {
  side: TradeSide;
  entry: number;
  stop: number;
  /** Размер позиции: в деньгах и в самой монете. */
  notional: number;
  qty: number;
  /** Потери на стопе: в деньгах и в процентах от маржи. */
  risk: number;
  riskPct: number;
  targets: TradeTarget[];
  /** Отношение прибыли к риску по последней цели. */
  rr: number;
  /** Ориентировочная цена ликвидации: без комиссий и поддерживающей маржи. */
  liquidation: number;
  /** Ликвидация ближе стопа — позицию вынесет раньше, чем сработает стоп. */
  liquidatedFirst: boolean;
};

/** Цели по умолчанию: 1R, 2R и 3R. */
export const DEFAULT_TAKES = [1, 2, 3];

export const DEFAULT_MARGIN = 100;
export const DEFAULT_LEVERAGE = 10;

// Потолок плеча. Четыреста — предел, который биржа даёт на ликвидных парах.
export const MAX_LEVERAGE = 400;

// Границы стопа. Ниже сотой доли процента стоп попадает в спред и выбивается
// шумом; больше десяти процентов — это уже не скальп от уровня.
export const MIN_STOP_PCT = 0.01;
export const MAX_STOP_PCT = 10;

/**
 * Сторона сделки по стороне полки.
 *
 * Полка в заявках на покупку — это поддержка: цена приходит на неё сверху и
 * отскакивает вверх, значит лонг. Полка в продажах — сопротивление, значит шорт.
 */
export function sideForShelf(shelf: "bid" | "ask"): TradeSide {
  return shelf === "bid" ? "long" : "short";
}

/**
 * Стоп по волатильности инструмента.
 *
 * Половина ATR: ставить стоп ближе среднего хода свечи бессмысленно — его
 * снимет обычным движением, а не отменой идеи.
 */
export function suggestStopPct(atr: number, price: number): number {
  if (!(atr > 0) || !(price > 0)) return 0.15;
  const pct = ((atr * 0.5) / price) * 100;
  return Math.min(MAX_STOP_PCT, Math.max(MIN_STOP_PCT, Number(pct.toFixed(3))));
}

/** Расчёт сделки. `null`, если ввод бессмыслен — считать нечего. */
export function computeTrade(input: TradeInput): TradePlan | null {
  const { entry, side, stopPct, margin, leverage, takes } = input;
  if (!(entry > 0) || !(margin > 0) || !(leverage >= 1) || !(stopPct > 0)) return null;

  const distance = (entry * stopPct) / 100;
  const long = side === "long";
  const stop = long ? entry - distance : entry + distance;
  if (stop <= 0) return null;

  const notional = margin * leverage;
  const qty = notional / entry;
  const risk = qty * distance;

  const targets = takes.map((r) => ({
    r,
    price: long ? entry + r * distance : entry - r * distance,
    profit: qty * r * distance,
  }));

  // Изолированная маржа без комиссий и поддерживающей маржи: настоящая цена у
  // биржи чуть ближе, поэтому в интерфейсе она подписана как ориентировочная.
  const liquidation = long ? entry * (1 - 1 / leverage) : entry * (1 + 1 / leverage);

  return {
    side,
    entry,
    stop,
    notional,
    qty,
    risk,
    riskPct: (risk / margin) * 100,
    targets,
    rr: takes.length > 0 ? takes[takes.length - 1] : 0,
    liquidation,
    liquidatedFirst: long ? stop <= liquidation : stop >= liquidation,
  };
}
