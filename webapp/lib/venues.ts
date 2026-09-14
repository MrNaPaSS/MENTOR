// Биржи терминала для публичных страниц: где торгуем и сколько возвращаем.
//
// В кабинете эти цифры приходят с сервера (`/api/exchanges`, core/venues.py).
// Лендинг собирается заранее и сервера не спрашивает, поэтому список нужен
// ему свой - и это ровно то место, где цифры однажды разъехались: в кабинете
// стояло 15%, на витрине лендинга - «до 40%», а в боте академии третье число.
// Обещание, размазанное по трём местам, расходится само.
//
// Здесь оно одно, и его сторожит тест `tests/test_landing_venues.py`: он
// читает этот файл и сверяет с `core/venues.py`. Поправили сервер - тест
// упадёт, пока не поправлен и лендинг.
//
// Доля возврата - та, которую академия обещает ученику в боте при
// регистрации (`exchange_accounts.py`, `COMMISSION_DISCOUNTS`). Ноль и пусто
// значат разное: ноль - биржа запрещает партнёрам делиться комиссией, пусто -
// долю ещё не назвали.

export type PublicVenue = {
  code: string;
  name: string;
  /** Терминал уже торгует на этой бирже. */
  trading: boolean;
  /** Доля возврата комиссии. 0 - биржа запрещает, null - ещё не названа. */
  cashback: number | null;
};

export const VENUES: readonly PublicVenue[] = [
  { code: "weex", name: "WEEX", trading: true, cashback: 0.15 },
  { code: "okx", name: "OKX", trading: true, cashback: 0.1 },
  { code: "bingx", name: "BingX", trading: true, cashback: 0.1 },
  { code: "mexc", name: "MEXC", trading: true, cashback: 0.1 },
  { code: "bybit", name: "Bybit", trading: false, cashback: null },
  { code: "bitget", name: "Bitget", trading: false, cashback: null },
  // Возврата на Binance не будет: биржа запрещает партнёрам возвращать
  // комиссию пользователям и урезает за это ставку. Прочитать это человек
  // обязан до регистрации, а не после.
  { code: "binance", name: "Binance", trading: true, cashback: 0 },
] as const;

/** Биржи, на которых терминал уже торгует - в порядке показа. */
export const TRADING: readonly PublicVenue[] = VENUES.filter((one) => one.trading);

/** Сколько бирж из списка ещё ждут подключения. */
export const PENDING = VENUES.length - TRADING.length;

/** Биржи, по которым возврат обещан и назван числом. */
export const PAYING: readonly PublicVenue[] = VENUES.filter(
  (one) => one.cashback !== null && one.cashback > 0,
);

/** Доля возврата в процентах: 0.15 -> «15%». Пусто - возврата нет. */
export function cashbackPct(share: number | null): string | null {
  if (share === null || !(share > 0)) return null;
  return `${Math.round(share * 100)}%`;
}

/**
 * «WEEX - 15%, OKX - 10%, BingX - 10%»: список для текстов и ответов FAQ.
 *
 * Без союзов и падежей намеренно: так он одинаково читается на обоих языках,
 * а текст вокруг него пишет словарь.
 */
export function cashbackList(): string {
  return PAYING.map((one) => `${one.name} - ${cashbackPct(one.cashback)}`).join(", ");
}
