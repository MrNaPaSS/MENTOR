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

/**
 * Доля комиссии, которая вернётся трейдеру на этой бирже сегодня.
 *
 * Считается не по лестнице уровней: лестница - это брокерская модель, и
 * включится она вместе с брокерской меткой, которой у нас пока нет ни на
 * одной бирже. Сегодня работает партнёрская модель, и доля у каждой биржи
 * своя - та самая, которую академия обещает ученику в боте при регистрации
 * (`lib/venues.ts`).
 *
 * Пусто и ноль здесь одинаково дают ноль возврата, но означают разное, и
 * разницу называет уже текст страницы: у Binance биржа запрещает возврат, у
 * MEXC долю ещё не назвали.
 */
export function cashbackShare(exchange: Exchange): number {
  return Math.min(exchange.cashback ?? 0, MAX_CASHBACK_SHARE);
}

/**
 * Доля возврата по лестнице уровней - то, что будет с брокерским статусом.
 *
 * Отдельной функцией, а не заменой расчёта: страница показывает лестницу как
 * план, и считать по ней сегодняшнюю экономию значило бы обещать её уже
 * сейчас.
 */
export function plannedShare(monthlyVolume: number): number {
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
  const share = cashbackShare(exchange);
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

/** Доля в границах 0..1: ползунок может прийти каким угодно. */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
