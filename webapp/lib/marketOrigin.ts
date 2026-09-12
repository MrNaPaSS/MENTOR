// Происхождение рыночной цифры: откуда она и насколько свежая.
//
// Бэкенд с этого выпуска подписывает каждый рыночный ответ: `source` - имя
// сработавшего источника, `stale` - это последнее известное значение, а не
// живое. Молча подменять источник или показывать вчерашнюю цену в терминале,
// где считают деньги, нельзя, поэтому в углу панели появляется тихая пометка.
//
// Тихая - значит мелкая и приглушённая: это не ошибка и не предупреждение, а
// сноска. Паниковать ученику не из-за чего, знать - стоит.

/** Что бэкенд сказал о происхождении ответа. */
export interface Origin {
  source?: string | null;
  stale?: boolean;
  /** Разбор по полям, когда ответ собран из нескольких источников. */
  sources?: Record<string, string> | null;
}

export interface OriginMark {
  /** Нужна ли пометка вообще: у свежих данных из своей биржи её нет. */
  show: boolean;
  stale: boolean;
  /** Имя источника; `null` - данных нет вовсе. */
  source: string | null;
  /** Ответ собран из разных источников. */
  mixed: boolean;
}

/** Источник, который для нас родной: по нему ученик и торгует. */
export const HOME_SOURCE = "weex";

const NAMES: Record<string, string> = {
  weex: "WEEX",
  binance: "Binance",
  coingecko: "CoinGecko",
  coinpaprika: "Coinpaprika",
  frankfurter: "Frankfurter",
  "mempool.space": "mempool.space",
  "alternative.me": "alternative.me",
};

/** Имя источника так, как его пишут люди. */
export function sourceName(source: string | null | undefined): string {
  if (!source) return "";
  return NAMES[source] ?? source;
}

/**
 * Нужна ли пометка и о чём она.
 *
 * Пометки нет в единственном случае: данные живые и пришли оттуда, откуда
 * ожидалось. Всё остальное - другой источник, устаревшее значение, смесь
 * источников или отсутствие данных - ученик видит.
 */
export function originMark(
  origin: Origin | null | undefined,
  home: string = HOME_SOURCE,
): OriginMark {
  const source = origin?.source ?? null;
  const stale = origin?.stale === true;
  const mixed = source === "mixed";
  const show = stale || mixed || (source !== null && source !== home);
  return { show, stale, source, mixed };
}
