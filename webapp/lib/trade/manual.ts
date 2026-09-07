// Ручная лимитка: вход, стоп и цель ставятся ценами, а не процентами.
//
// Расчёт от полки (plan.ts) идёт от идеи: уровень, стоп в процентах, цели в R.
// Здесь всё наоборот - трейдер тянет уровни мышью и видит цены, а проценты и
// соотношение считаются из них. Поэтому это отдельный файл, а не флаг в старом:
// у двух способов входа разный первичный ввод, и смешивать их значит получить
// расчёт, который в одном режиме считает от процента, а в другом от цены.
//
// Чистые функции без React и без графика: в деньгах ошибаться нельзя, а глазами
// такое не проверишь.

import type { TradeSide } from "./plan";

/** Уровень, который можно перетащить. */
export type LevelKind = "entry" | "stop" | "take";

export type ManualDraft = {
  side: TradeSide;
  entry: number;
  stop: number;
  take: number;
  margin: number;
  leverage: number;
};

/**
 * Насколько цель дальше стопа по умолчанию.
 *
 * Два к одному: сделка, где рискуют больше, чем берут, требует попадать чаще,
 * чем ошибаться, а скальпинг так не работает. Трейдер всё равно тянет цель
 * куда хочет - но начинать он должен не с убыточного соотношения.
 */
const DEFAULT_RR = 2;

/**
 * Заготовка лимитки от цены, на которую нажал трейдер.
 *
 * Сторону трейдер называет сам - её спрашивают в меню у цены. Не назвал -
 * берём по тому, где цена относительно рынка: ниже рынка покупают, выше
 * продают.
 *
 * Расстояние до стопа - половина ATR, как и в расчёте от полки: ближе стоп
 * снимается обычным шумом свечи, а не отменой идеи.
 */
export function draftAt(
  price: number,
  market: number,
  atr: number,
  margin: number,
  leverage: number,
  want?: TradeSide,
): ManualDraft {
  const side: TradeSide = want ?? (market > 0 && price > market ? "short" : "long");
  const step = atr > 0 ? atr * 0.5 : price * 0.0015;
  const long = side === "long";
  return {
    side,
    entry: price,
    stop: long ? price - step : price + step,
    take: long ? price + step * DEFAULT_RR : price - step * DEFAULT_RR,
    margin,
    leverage,
  };
}

/** Объём позиции в монете: маржа с плечом, поделённая на цену входа. */
export function qtyOf(draft: ManualDraft): number {
  if (!(draft.entry > 0) || !(draft.margin > 0) || !(draft.leverage >= 1)) return 0;
  return (draft.margin * draft.leverage) / draft.entry;
}

/** Убыток на стопе, в деньгах. Всегда положительное число. */
export function riskOf(draft: ManualDraft): number {
  return qtyOf(draft) * Math.abs(draft.entry - draft.stop);
}

/** Прибыль на цели, в деньгах. */
export function rewardOf(draft: ManualDraft): number {
  return qtyOf(draft) * Math.abs(draft.take - draft.entry);
}

/** Отношение прибыли к риску. Ноль - когда стоп стоит вплотную ко входу. */
export function rrOf(draft: ManualDraft): number {
  const risk = Math.abs(draft.entry - draft.stop);
  if (!(risk > 0)) return 0;
  return Math.abs(draft.take - draft.entry) / risk;
}

/**
 * Сторона сделки по расположению уровней.
 *
 * Цель выше входа - покупают, ниже - продают. Это единственное определение,
 * которое не спорит с картинкой: трейдер видит, куда смотрит его цель, и
 * никакой переключатель не убедит его в обратном.
 */
export function sideOf(entry: number, take: number): TradeSide {
  return take >= entry ? "long" : "short";
}

/**
 * Куда на самом деле встанет перетащенный уровень.
 *
 * Стоп по ту сторону входа - это не стоп, а вторая цель; цель по ту сторону -
 * не цель. Биржа такую заявку отклонит, поэтому уровень останавливается на шаг
 * от входа и дальше не идёт: трейдер видит, где предел, вместо того чтобы
 * узнать о нём отказом после нажатия.
 *
 * Вход двигается свободно, но тянет за собой стоп и цель: расстояния до них
 * трейдер задал сам, и терять их при переносе входа он не просил.
 */
export function moveLevel(
  draft: ManualDraft,
  kind: LevelKind,
  price: number,
  tick: number,
): ManualDraft {
  if (!(price > 0)) return draft;
  const step = tick > 0 ? tick : draft.entry * 1e-6;

  if (kind === "entry") {
    const shift = price - draft.entry;
    return { ...draft, entry: price, stop: draft.stop + shift, take: draft.take + shift };
  }

  const long = draft.side === "long";
  if (kind === "stop") {
    const limit = long ? draft.entry - step : draft.entry + step;
    return { ...draft, stop: long ? Math.min(price, limit) : Math.max(price, limit) };
  }

  const limit = long ? draft.entry + step : draft.entry - step;
  return { ...draft, take: long ? Math.max(price, limit) : Math.min(price, limit) };
}

/**
 * Наибольшая сумма, с которой сделку вообще примут.
 *
 * Ограничений три, и берётся самое строгое: свободные деньги счёта - маржу
 * больше остатка внести нечем; потолок одной заявки по монете; потолок всей
 * позиции. Два последних биржа держит в монете, поэтому переводим их в деньги
 * через цену входа и плечо.
 *
 * Ноль означает «предел неизвестен»: биржа его не назвала, и выдумывать за неё
 * нельзя - лучше не ограничивать вовсе, чем запретить возможное.
 */
export function maxMargin(
  entry: number,
  leverage: number,
  free: number,
  caps: { maxQty?: number; maxPosition?: number } = {},
): number {
  if (!(entry > 0) || !(leverage >= 1)) return 0;

  const limits: number[] = [];
  if (free > 0) limits.push(free);
  for (const qty of [caps.maxQty, caps.maxPosition]) {
    if (qty && qty > 0) limits.push((qty * entry) / leverage);
  }
  if (limits.length === 0) return 0;
  return Math.min(...limits);
}

/**
 * Развернуть заготовку на другую сторону.
 *
 * Стоп и цель меняются местами относительно входа, расстояния сохраняются:
 * трейдер передумал о направлении, а не о том, чем рискует.
 */
export function flip(draft: ManualDraft): ManualDraft {
  return {
    ...draft,
    side: draft.side === "long" ? "short" : "long",
    stop: draft.entry + (draft.entry - draft.stop),
    take: draft.entry + (draft.entry - draft.take),
  };
}
