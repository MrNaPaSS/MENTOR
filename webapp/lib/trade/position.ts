// Жизненный цикл сделки от уровня.
//
// Расчёт (plan.ts) отвечает на вопрос «сколько», этот файл — на вопрос «что
// сейчас». Сделка проходит три состояния: рассчитана и ждёт цену, открыта,
// закрыта. Переходы считаются по одной цене — последней сделке рынка, — и
// только вперёд: сделка, которая уже закрылась, не открывается заново.
//
// Всё чистыми функциями и без мутаций: состояние сделки идёт в журнал и в
// календарь прибыли, и «само» меняться оно не должно.

import type { TradeSide } from "./plan";

export type TradeStatus = "planned" | "open" | "closed";

/** Чем закончилась сделка. */
export type TradeOutcome = "stop" | "take" | "manual" | null;

export type ActiveTrade = {
  id: string;
  symbol: string;
  side: TradeSide;
  /** Цена входа — цена уровня, от которого считали. */
  entry: number;
  /** Текущий стоп: после первой цели переносится в безубыток. */
  stop: number;
  /** Стоп, с которым сделка задумывалась. Нужен журналу: по нему считался риск. */
  initialStop: number;
  targets: number[];
  qty: number;
  margin: number;
  leverage: number;
  status: TradeStatus;
  /** Сколько целей уже взято. */
  takesHit: number;
  /** Стоп переставлен в безубыток. */
  breakeven: boolean;
  /** Когда сделка была рассчитана: к этому месту на графике привязан бокс. */
  createdAt: number;
  openedAt: number | null;
  closedAt: number | null;
  exit: number | null;
  outcome: TradeOutcome;
  /** Итог в деньгах. У незакрытой сделки — ноль. */
  pnl: number;
};

export type TradeSeed = {
  symbol: string;
  side: TradeSide;
  entry: number;
  stop: number;
  targets: number[];
  qty: number;
  margin: number;
  leverage: number;
};

/** Новая сделка: рассчитана, но цена до уровня ещё не дошла. */
export function createTrade(seed: TradeSeed, id: string, now = Date.now()): ActiveTrade {
  return {
    id,
    symbol: seed.symbol,
    side: seed.side,
    entry: seed.entry,
    stop: seed.stop,
    initialStop: seed.stop,
    targets: [...seed.targets],
    qty: seed.qty,
    margin: seed.margin,
    leverage: seed.leverage,
    status: "planned",
    takesHit: 0,
    breakeven: false,
    createdAt: now,
    openedAt: null,
    closedAt: null,
    exit: null,
    outcome: null,
    pnl: 0,
  };
}

/** Прибыль или убыток по текущей цене. У незакрытой сделки — плавающий. */
export function pnlAt(trade: ActiveTrade, price: number): number {
  if (trade.status === "planned") return 0;
  if (trade.status === "closed") return trade.pnl;
  const move = trade.side === "long" ? price - trade.entry : trade.entry - price;
  return move * trade.qty;
}

/** Цели, которые ещё не взяты: взятую с графика убираем. */
export function pendingTargets(trade: ActiveTrade): number[] {
  return trade.targets.slice(trade.takesHit);
}

/**
 * Продвинуть сделку по новой цене рынка.
 *
 * Возвращает ту же ссылку, если ничего не изменилось: перерисовывать график и
 * писать в журнал есть смысл только на переходах, а цена приходит восемь раз в
 * секунду.
 *
 * Порядок проверок — стоп раньше целей. Внутри одного тика мы не знаем, что
 * рынок задел первым, и считать в свою пользу нельзя: в журнале окажется
 * прибыль, которой не было.
 */
export function advance(trade: ActiveTrade, price: number, now: number): ActiveTrade {
  if (trade.status === "closed" || !(price > 0)) return trade;
  const long = trade.side === "long";

  if (trade.status === "planned") {
    const reached = long ? price <= trade.entry : price >= trade.entry;
    if (!reached) return trade;
    return advance({ ...trade, status: "open", openedAt: now }, price, now);
  }

  const stopped = long ? price <= trade.stop : price >= trade.stop;
  if (stopped) {
    return {
      ...trade,
      status: "closed",
      closedAt: now,
      exit: trade.stop,
      // Безубыток — это тоже стоп, но по деньгам ноль, и в журнале он должен
      // отличаться от сделки, вынесенной в минус.
      outcome: "stop",
      pnl: (long ? trade.stop - trade.entry : trade.entry - trade.stop) * trade.qty,
    };
  }

  let hit = trade.takesHit;
  while (hit < trade.targets.length) {
    const target = trade.targets[hit];
    if (long ? price >= target : price <= target) hit += 1;
    else break;
  }
  if (hit === trade.takesHit) return trade;

  // Последняя цель взята — сделка отработана полностью.
  if (hit >= trade.targets.length) {
    const exit = trade.targets[trade.targets.length - 1];
    return {
      ...trade,
      takesHit: hit,
      status: "closed",
      closedAt: now,
      exit,
      outcome: "take",
      pnl: (long ? exit - trade.entry : trade.entry - exit) * trade.qty,
    };
  }

  // После первой цели стоп в безубыток: сделка больше не может стать убыточной.
  return { ...trade, takesHit: hit, breakeven: true, stop: trade.entry };
}

/**
 * Продвинуть сделку по стакану, а не по средней цене.
 *
 * Заявка исполняется не «по цене вообще», а по своей стороне книги: лимитная
 * покупка на поддержке срабатывает, когда до неё дошло предложение, то есть
 * лучшая продажа. Средняя цена в этот момент ещё выше уровня, и сделка,
 * которую рынок уже задел, оставалась бы ждущей.
 *
 * У открытой позиции всё наоборот: закрывать её придётся встречной стороной,
 * поэтому стоп и цели лонга считаются по лучшей покупке.
 */
export function advanceQuote(
  trade: ActiveTrade,
  quote: { bid: number; ask: number },
  now: number,
): ActiveTrade {
  const long = trade.side === "long";
  const price =
    trade.status === "planned"
      ? long
        ? quote.ask
        : quote.bid
      : long
        ? quote.bid
        : quote.ask;
  if (!(price > 0)) return trade;
  return advance(trade, price, now);
}

/** Закрыть руками по текущей цене. */
export function closeManually(trade: ActiveTrade, price: number, now: number): ActiveTrade {
  if (trade.status === "closed") return trade;
  const long = trade.side === "long";
  const exit = price > 0 ? price : trade.entry;
  return {
    ...trade,
    status: "closed",
    closedAt: now,
    exit,
    outcome: "manual",
    pnl: trade.status === "open" ? (long ? exit - trade.entry : trade.entry - exit) * trade.qty : 0,
  };
}
