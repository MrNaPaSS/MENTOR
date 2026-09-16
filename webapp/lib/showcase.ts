// Витрина карточек на лендинге: сделки, которыми она набрана.
//
// Один список на две работы. По нему генератор (`scripts/render-pnl.mjs`)
// рисует карточки в `public/showcase/nmnh`, и по нему же считаются числа над
// лентой на главной. Разъехаться они не могут: витрина, обещающая сумму, и
// карточки, дающие другую, - это не опечатка, а обман.
//
// Сделки настоящие, наставника, с отчётов WEEX. Правится список руками, после
// чего карточки пересобираются командой `node scripts/render-pnl.mjs`.

import type { CardSide } from "@/lib/pnl/card";

export interface ShowcaseTrade {
  /** Имя файла без расширения: общее для нашей карточки и биржевой. */
  file: string;
  symbol: string;
  side: CardSide;
  leverage: number;
  /** Заготовка карточки - `id` из `VARIANTS`. */
  variant: string;
  /** Доход в процентах от залога - так его считает биржа. */
  roi: number;
  /** Доход в USDT, уже за вычетом комиссии. */
  pnl: number;
  entry: number;
  exit: number;
  /** Когда закрылась, по часам наставника. */
  at: string;
}

/** Чья витрина: имя на карточке и биржа под печатью. */
export const SHOWCASE_OWNER = "kaktotakxm";
export const SHOWCASE_VENUE = "WEEX Futures";

/** Сделки витрины. Порядок здесь - порядок ленты. */
export const SHOWCASE_TRADES: readonly ShowcaseTrade[] = [
  {
    file: "01-xrpusdt",
    symbol: "XRPUSDT",
    side: "long",
    leverage: 25,
    variant: "bull",
    roi: 316.29,
    pnl: 6140.301,
    entry: 1.1358,
    exit: 1.2795,
    at: "2026-06-15T19:22:09",
  },
  {
    file: "02-jupusdt",
    symbol: "JUPUSDT",
    side: "long",
    leverage: 25,
    variant: "neon-long",
    roi: 776.57,
    pnl: 12021.3087,
    entry: 0.1522,
    exit: 0.1995,
    at: "2026-06-15T18:18:54",
  },
  {
    file: "03-taousdt",
    symbol: "TAOUSDT",
    side: "long",
    leverage: 25,
    variant: "chart-long",
    roi: 481.71,
    pnl: 5850.1847,
    entry: 208.02,
    exit: 248.11,
    at: "2026-06-13T12:03:32",
  },
  {
    file: "04-jupusdt",
    symbol: "JUPUSDT",
    side: "long",
    leverage: 25,
    variant: "mono",
    roi: 311.78,
    pnl: 4826.3167,
    entry: 0.1522,
    exit: 0.1712,
    at: "2026-06-12T17:14:35",
  },
  {
    file: "05-injusdt",
    symbol: "INJUSDT",
    side: "short",
    leverage: 25,
    variant: "whale-short",
    roi: 262.47,
    pnl: 5090.4101,
    entry: 5.736,
    exit: 5.134,
    at: "2026-06-10T10:49:57",
  },
  {
    file: "06-hypeusdt",
    symbol: "HYPEUSDT",
    side: "short",
    leverage: 25,
    variant: "neon-short",
    roi: 202.43,
    pnl: 2946.5702,
    entry: 64.991,
    exit: 59.729,
    at: "2026-06-09T16:11:19",
  },
  {
    file: "07-wldusdt",
    symbol: "WLDUSDT",
    side: "short",
    leverage: 25,
    variant: "graffiti-short",
    roi: 302.3,
    pnl: 1467.27,
    entry: 0.5437,
    exit: 0.4795,
    at: "2026-06-05T17:12:55",
  },
  {
    file: "08-injusdt",
    symbol: "INJUSDT",
    side: "long",
    leverage: 25,
    variant: "bull",
    roi: 171.62,
    pnl: 3129.1803,
    entry: 4.955,
    exit: 5.291,
    at: "2026-06-05T16:18:41",
  },
] as const;

/**
 * Что витрина показывает числами: сумма, лучшая сделка, сколько их.
 *
 * Считается здесь, а не пишется в словаре: строка «+41 471 USDT» рядом с
 * лентой обязана быть суммой именно этой ленты, а не тем, что однажды
 * посчитали руками и забыли обновить.
 */
export const SHOWCASE_TOTALS = {
  pnl: SHOWCASE_TRADES.reduce((sum, trade) => sum + trade.pnl, 0),
  bestRoi: SHOWCASE_TRADES.reduce((best, trade) => Math.max(best, trade.roi), 0),
  count: SHOWCASE_TRADES.length,
} as const;
