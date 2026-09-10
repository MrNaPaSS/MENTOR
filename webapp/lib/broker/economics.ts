/**
 * Арифметика комиссии, возврата и подписки.
 *
 * Всё здесь - чистые функции над числами: их считает и калькулятор на
 * странице, и тесты, и они же дают цифры для текста разделов. Ни одна не
 * знает о React, локали и оформлении - иначе проверить их было бы нечем.
 *
 * Деньги на витрине считаются числами с плавающей точкой намеренно. Это
 * оценка «сколько ты сэкономишь», а не расчёт к выплате: в реестре начислений
 * (план, §2, п.5) суммы обязаны быть Decimal, и там своя арифметика.
 */
import {
  CASHBACK_TIERS,
  MIN_MARGIN,
  REBATE_SHARE,
  YEAR_MONTHS,
  type CashbackTier,
  type Exchange,
} from "./program";

export interface TradingProfile {
  /** Оборот за 30 дней в USDT: сумма всех входов и выходов. */
  monthlyVolume: number;
  /** Доля объёма, взятая по рынку (тейкером), 0..1. */
  takerShare: number;
}

/**
 * Средняя ставка комиссии по стилю торговли.
 *
 * Одной цифрой ставку не назвать: скальпер, который заливает по рынку, и
 * лимитчик на одной бирже платят вчетверо разные деньги. Поэтому ставка
 * смешивается по доле тейкерного объёма - именно она и решает всю экономику.
 */
export function blendedRate(exchange: Exchange, takerShare: number): number {
  const taker = clamp01(takerShare);
  return exchange.takerRate * taker + exchange.makerRate * (1 - taker);
}

/** Комиссия за 30 дней при таком обороте и такой средней ставке. */
export function monthlyCommission(monthlyVolume: number, rate: number): number {
  return Math.max(0, monthlyVolume) * rate;
}

/** Уровень возврата по обороту за 30 дней. */
export function tierFor(monthlyVolume: number): CashbackTier {
  const volume = Math.max(0, monthlyVolume);
  // Идём с конца: уровни отсортированы по возрастанию порога, и первый
  // подошедший с хвоста - самый высокий из достигнутых.
  for (let i = CASHBACK_TIERS.length - 1; i >= 0; i -= 1) {
    if (volume >= CASHBACK_TIERS[i].fromVolume) return CASHBACK_TIERS[i];
  }
  return CASHBACK_TIERS[0];
}

/**
 * Потолок возврата: больше него программа работает в убыток.
 *
 * Считается от ребейта биржи за вычетом минимальной маржи NMNH - то же
 * ограничение, что в плане (§2, «но не больше»).
 */
export const MAX_CASHBACK_SHARE = REBATE_SHARE - MIN_MARGIN;

/** Доля комиссии, которая вернётся трейдеру с таким оборотом. */
export function cashbackShare(monthlyVolume: number): number {
  return Math.min(tierFor(monthlyVolume).share, MAX_CASHBACK_SHARE);
}

export interface Outcome {
  /** Средняя ставка до возврата. */
  rate: number;
  /** Комиссия за 30 дней. */
  commission: number;
  /** Доля комиссии, которая возвращается. */
  share: number;
  /** Возврат за 30 дней. */
  cashback: number;
  /** Ставка после возврата - то, что человек реально платит. */
  effectiveRate: number;
  /** Что остаётся в кармане за год. */
  yearly: number;
}

/** Полный расчёт по трейдеру: сколько платит, сколько возвращается. */
export function outcomeFor(exchange: Exchange, profile: TradingProfile): Outcome {
  const rate = blendedRate(exchange, profile.takerShare);
  const commission = monthlyCommission(profile.monthlyVolume, rate);
  const share = cashbackShare(profile.monthlyVolume);
  const cashback = commission * share;

  return {
    rate,
    commission,
    share,
    cashback,
    effectiveRate: rate * (1 - share),
    yearly: cashback * YEAR_MONTHS,
  };
}

/**
 * Тариф подписочного брокера - то, с чем нас сравнивают.
 *
 * Модель обобщённая, без имени сервиса: конкретные цифры у всех разъезжаются
 * от месяца к месяцу, а конструкция у них одна - платишь абонплату, получаешь
 * процент возврата побольше.
 */
export interface SubscriptionPlan {
  id: string;
  /** Абонплата в месяц, USD. */
  price: number;
  /** Доля комиссии, которую возвращает этот тариф. */
  share: number;
}

export interface PlanOutcome {
  /** Возврат за 30 дней до вычета абонплаты. */
  cashback: number;
  /** Абонплата за 30 дней. */
  price: number;
  /** Что осталось: возврат минус подписка. Бывает отрицательным. */
  net: number;
  /** То же за год. */
  yearly: number;
}

/** Сколько тариф оставляет трейдеру после вычета собственной абонплаты. */
export function planOutcome(commission: number, plan: SubscriptionPlan): PlanOutcome {
  const cashback = commission * plan.share;
  const net = cashback - plan.price;
  return { cashback, price: plan.price, net, yearly: net * YEAR_MONTHS };
}

/**
 * Оборот, на котором подписка перестаёт быть убытком.
 *
 * Ниже этой цифры тариф забирает абонплатой больше, чем возвращает
 * комиссией - то есть человек платит за право получать свои же деньги.
 */
export function subscriptionBreakeven(plan: SubscriptionPlan, rate: number): number {
  if (plan.share <= 0 || rate <= 0) return Infinity;
  return plan.price / (plan.share * rate);
}

/**
 * Оборот, на котором переход на тариф выше окупается одной лишь разницей
 * процентов.
 *
 * Самое неудобное число в подписочной модели: разница между тарифами обычно
 * два-пять пунктов, а доплата - десятки долларов, и порог уезжает в миллионы
 * оборота. Считаем его честно и показываем.
 */
export function upgradeBreakeven(
  from: SubscriptionPlan,
  to: SubscriptionPlan,
  rate: number,
): number {
  const deltaShare = to.share - from.share;
  const deltaPrice = to.price - from.price;
  if (deltaShare <= 0 || rate <= 0) return Infinity;
  if (deltaPrice <= 0) return 0;
  return deltaPrice / (deltaShare * rate);
}

/**
 * Разница между нами и тарифом за год.
 *
 * Положительная - у нас остаётся больше. Именно это число и есть ответ на
 * вопрос «зачем мне менять брокера».
 */
export function yearlyAdvantage(ours: Outcome, plan: PlanOutcome): number {
  return ours.yearly - plan.yearly;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
