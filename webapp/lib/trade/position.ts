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

/**
 * Доли позиции, которые забирает каждая цель.
 *
 * Первая снимает треть риска, вторая выводит половину, остаток едет до
 * последней. Целей другого числа делим поровну — правило написано для лестницы
 * из трёх. Те же числа стоят на сервере: расхождение здесь означало бы, что на
 * экране одна сделка, а на бирже другая.
 */
export const TAKE_SHARES = [0.3, 0.5, 0.2];

/**
 * Комиссия тейкера. Платится на обеих ногах позиции, поэтому в безубытке
 * учитывается дважды.
 */
export const TAKER_FEE = 0.0004;

/**
 * Цена, при которой позиция закрывается в настоящий ноль.
 *
 *   лонг:  (P − вход)·объём = комиссия·вход·объём + комиссия·P·объём
 *          → P = вход · (1 + комиссия) / (1 − комиссия)
 *   шорт:  P = вход · (1 − комиссия) / (1 + комиссия)
 */
export function breakevenPrice(entry: number, long: boolean, fee = TAKER_FEE): number {
  return long ? (entry * (1 + fee)) / (1 - fee) : (entry * (1 - fee)) / (1 + fee);
}

export function takeShare(index: number, count: number): number {
  if (count <= 0 || index < 0 || index >= count) return 0;
  return count === TAKE_SHARES.length ? TAKE_SHARES[index] : 1 / count;
}

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
  /** Сколько монет осталось в позиции: цели закрывают её по частям. */
  qty: number;
  /** Объём, с которым сделка открывалась. По нему считаются доли целей. */
  initialQty: number;
  /** Уже забранная прибыль по взятым целям. */
  realized: number;
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
  /** Сколько раз позицию уже частично фиксировали. */
  partials: number;
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
    initialQty: seed.qty,
    realized: 0,
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
    partials: 0,
  };
}

/**
 * Результат сделки по текущей цене: забранное плюс плавающее.
 *
 * Считать плавающий результат на весь исходный объём нельзя: взятая цель уже
 * закрыла свою часть по своей цене, и она в рынке больше не участвует. Именно
 * так и получалось, что на экране висело вдвое больше, чем пришло на счёт.
 */
export function floatingAt(trade: ActiveTrade, price: number): number {
  if (trade.status !== "open") return 0;
  const move = trade.side === "long" ? price - trade.entry : trade.entry - price;
  return move * trade.qty;
}

/**
 * Итог по сделке целиком: забранное по целям плюс плавающее по остатку.
 *
 * Это не то же самое, что показывает биржа. Она знает только открытую позицию,
 * и после сработавшей цели её цифра относится к остатку. Обе честные, но
 * смешивать их нельзя — иначе на экране 219 там, где на счёт пришло 148.
 */
export function pnlAt(trade: ActiveTrade, price: number): number {
  if (trade.status === "planned") return 0;
  if (trade.status === "closed") return trade.pnl;
  const move = trade.side === "long" ? price - trade.entry : trade.entry - price;
  return trade.realized + move * trade.qty;
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
      pnl:
        trade.realized +
        (long ? trade.stop - trade.entry : trade.entry - trade.stop) * trade.qty,
    };
  }

  let hit = trade.takesHit;
  while (hit < trade.targets.length) {
    const target = trade.targets[hit];
    if (long ? price >= target : price <= target) hit += 1;
    else break;
  }
  if (hit === trade.takesHit) return trade;

  // Каждая цель закрывает свою долю исходного объёма по своей цене. Забранное
  // складываем, оставшийся объём уменьшаем: закрытая часть в рынке больше не
  // участвует, и считать её по текущей цене — врать себе.
  let realized = trade.realized;
  let closed = 0;
  for (let i = trade.takesHit; i < hit; i++) {
    const part = trade.initialQty * takeShare(i, trade.targets.length);
    const target = trade.targets[i];
    realized += (long ? target - trade.entry : trade.entry - target) * part;
    closed += part;
  }
  const left = Math.max(0, trade.qty - closed);

  // Последняя цель взята — сделка отработана полностью.
  if (hit >= trade.targets.length) {
    return {
      ...trade,
      takesHit: hit,
      qty: 0,
      realized,
      status: "closed",
      closedAt: now,
      exit: trade.targets[trade.targets.length - 1],
      outcome: "take",
      pnl: realized,
    };
  }

  // После первой цели стоп в безубыток: сделка больше не может стать убыточной.
  // Ровно цена входа безубытком не является — комиссия уже уплачена на входе и
  // будет уплачена на выходе. Биржа пришлёт свою цену на следующем опросе,
  // до тех пор считаем сами, чтобы подпись не стояла на линии входа.
  return {
    ...trade,
    takesHit: hit,
    qty: left,
    realized,
    breakeven: true,
    stop: breakevenPrice(trade.entry, long),
  };
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
  /**
   * Сделка живёт на бирже: вход и выход подтверждает она, а не наша
   * арифметика.
   *
   * Цена может коснуться уровня, а лимитка при этом не исполниться — очередь в
   * стакане длиннее одного касания. Пока мы считали вход сами, разметка
   * набранной позиции появлялась раньше самой позиции: бокс, стоп и цели
   * стояли на графике у сделки, которой на бирже ещё нет. Цели и безубыток по
   * цене считаем и здесь — это разметка идущей позиции, а не её судьба.
   */
  live = false,
): ActiveTrade {
  if (live && trade.status === "planned") return trade;

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

  const next = advance(trade, price, now);
  // Закрытие тоже за биржей: терминал уже показывал «закрыто», пока позиция
  // оставалась открытой.
  return live && next.status === "closed" && trade.status !== "closed" ? trade : next;
}

/**
 * Зафиксировать часть позиции.
 *
 * Возвращает две вещи: что осталось на графике и что уходит в журнал. Частичная
 * фиксация — это отдельная закрытая сделка со своим объёмом и своим итогом:
 * записать её как одну сделку целиком значит соврать и в прибыли, и в
 * количестве сделок.
 *
 * Доля считается от текущего остатка, а не от исходного объёма: трейдер видит
 * на экране то, что у него есть сейчас, и «половина» для него — половина этого.
 */
export function closePartially(
  trade: ActiveTrade,
  share: number,
  price: number,
  now: number,
): { remaining: ActiveTrade; recorded: ActiveTrade | null } {
  if (trade.status === "closed" || !(share > 0)) {
    return { remaining: trade, recorded: null };
  }

  // Незашедшая сделка — это отменённый расчёт, а не сделка: фиксировать нечего.
  if (trade.status === "planned") {
    return { remaining: closeManually(trade, price, now), recorded: null };
  }

  const part = Math.min(1, share);
  const exit = price > 0 ? price : trade.entry;
  const long = trade.side === "long";
  const closedQty = trade.qty * part;
  const pnl = (long ? exit - trade.entry : trade.entry - exit) * closedQty;

  const recorded: ActiveTrade = {
    ...trade,
    // Своя запись в журнале: у части свой объём и свой результат. Забранное по
    // целям сюда не приплюсовываем — оно уже записано своими строками.
    id: `${trade.id}#${trade.partials + 1}`,
    qty: closedQty,
    realized: 0,
    margin: trade.margin * part,
    status: "closed",
    closedAt: now,
    exit,
    outcome: "manual",
    pnl,
  };

  if (part >= 1) {
    return { remaining: recorded, recorded };
  }

  return {
    remaining: {
      ...trade,
      qty: trade.qty - closedQty,
      margin: trade.margin * (1 - part),
      partials: trade.partials + 1,
    },
    recorded,
  };
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
    pnl:
      trade.status === "open"
        ? trade.realized + (long ? exit - trade.entry : trade.entry - exit) * trade.qty
        : 0,
  };
}
