// Позиции глазами биржи: разбор её ответа в понятные числа.
//
// Отдельным файлом, потому что читателей у этого ответа двое - зеркало сделки
// в терминале и опрос объёмов по всем монетам, - и разбор у них был свой.
// Копии успели разойтись: одна вычитала комиссию входа из плавающего
// результата, другая не знала о нём вовсе, и на экране рядом стояли два разных
// плюса по одной позиции.
//
// Всё чистыми функциями: сюда приходит ответ биржи, отсюда уходят числа.

/** Открытая позиция глазами биржи. */
export type LivePosition = {
  size: number;
  /**
   * Средняя цена входа. null - биржа её не назвала.
   *
   * По ней разбирается, какая из нескольких ждущих заявок исполнилась: позиция
   * приходит одной строкой на монету и сторону, а лимиток в лонг может стоять
   * две - одна выше, другая ниже.
   */
  entry: number | null;
  /**
   * Плавающий результат - за вычетом комиссии, удержанной на входе.
   *
   * `unrealizePnl` биржа отдаёт до неё, а в своём приложении показывает уже
   * после: по шорту ETH на 20,225 по 2472,11 терминал писал +36,05, а биржа
   * +28,05 - ровно на 8,00, уплаченные за вход.
   */
  unrealized: number | null;
  /** Цена безубытка по расчёту биржи. Пусто - она её не назвала. */
  breakeven: number | null;
};

/**
 * Все открытые позиции счёта одним снимком.
 *
 * Ключ - «монета:сторона». Кроме самих позиций снимок несёт два счётчика, и
 * нужны они ровно для одного вопроса: пуст ли ответ по нашей монете или пуст
 * весь ответ целиком. Первое значит «позиции нет», второе - «биржа сейчас
 * ничего не рассказала», и хоронить сделку по второму нельзя.
 */
export type PositionBook = {
  byKey: Record<string, LivePosition>;
  /** Сколько строк биржа вернула всего, по всем монетам. */
  total: number;
  /** Сколько строк пришло по каждой монете. */
  rowsOf: Record<string, number>;
};

/** Первое читаемое ненулевое число из перечисленных полей. */
function num(row: Record<string, unknown>, ...names: string[]): number | null {
  for (const name of names) {
    const value = Number(row[name]);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return null;
}

/** Сторона позиции: биржа называет её по-разному, а в одностороннем режиме - никак. */
export function sideOf(row: Record<string, unknown>): "long" | "short" | "" {
  const name = String(row.positionSide ?? row.holdSide ?? row.side ?? "").toLowerCase();
  if (name.includes("long") || name.includes("buy")) return "long";
  if (name.includes("short") || name.includes("sell")) return "short";
  return "";
}

/**
 * Одна строка позиции в наши числа. null - строки нет или объём нулевой.
 *
 * Средней цены входа в ответе WEEX прямо нет: есть «сколько денег зашло» и «на
 * какой объём». Отношение и есть средняя, и считать результат нужно от неё -
 * от задуманного уровня цифра расходится с биржевой в разы.
 */
export function readPosition(
  row: Record<string, unknown>,
): { symbol: string; side: "long" | "short" | ""; position: LivePosition } | null {
  const symbol = String(row.symbol ?? "").toUpperCase();
  if (!symbol) return null;

  const size = Math.abs(num(row, "total", "size", "positionAmt", "available") ?? 0);
  if (!(size > 0)) return null;

  const openValue = num(row, "cumOpenValue", "openValue") ?? 0;
  const openSize = num(row, "cumOpenSize") ?? 0;
  const entry =
    num(row, "averageOpenPrice", "entryPrice", "avgPrice") ??
    (openValue > 0 && openSize > 0 ? openValue / openSize : null);

  // Комиссию входа вычитаем долей остатка: часть позиции, закрытая целями,
  // свою долю уже унесла.
  const raw = num(row, "unrealizePnl", "unrealizedPnl", "unrealizedProfit", "unrealisedPnl");
  const openFee = Math.abs(num(row, "cumOpenFee") ?? 0);
  const spent = openSize > 0 ? openFee * Math.min(1, size / openSize) : 0;

  return {
    symbol,
    side: sideOf(row),
    position: {
      size,
      entry,
      unrealized: raw === null ? null : raw - spent,
      breakeven: num(row, "breakEvenPrice", "breakevenPrice", "breakEven", "bePrice"),
    },
  };
}

/**
 * Ответ биржи целиком - в снимок позиций.
 *
 * Строку без стороны записываем под обе: в одностороннем режиме поля со
 * стороной может не быть вовсе, а позиция по монете тогда ровно одна.
 */
export function readBook(rows: Record<string, unknown>[]): PositionBook {
  const byKey: Record<string, LivePosition> = {};
  const rowsOf: Record<string, number> = {};
  let total = 0;

  for (const row of rows) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (symbol) {
      rowsOf[symbol] = (rowsOf[symbol] ?? 0) + 1;
      total += 1;
    }

    const read = readPosition(row);
    if (!read) continue;

    const keys =
      read.side === "" ? [`${read.symbol}:long`, `${read.symbol}:short`] : [`${read.symbol}:${read.side}`];
    for (const key of keys) {
      const was = byKey[key];
      byKey[key] = was
        ? {
            size: was.size + read.position.size,
            // Двух строк на один ключ биржа не отдаёт; если всё же отдала,
            // первое число честнее среднего от двух неизвестно чего.
            entry: was.entry ?? read.position.entry,
            unrealized: (was.unrealized ?? 0) + (read.position.unrealized ?? 0),
            breakeven: was.breakeven ?? read.position.breakeven,
          }
        : read.position;
    }
  }

  return { byKey, total, rowsOf };
}
