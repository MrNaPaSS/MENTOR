// Строки бегущей ленты между опросами.
//
// Скринер отдаёт пары по обороту, и порядок у соседей по списку меняется чуть
// ли не на каждом опросе. Для таблицы это правда рынка, для ленты - рывок:
// пары, которые человек провожал глазами, на ходу менялись местами, и строка
// будто перескакивала. Здесь порядок держится: старые пары остаются на своих
// местах с новыми ценами, новичок встаёт на место выбывшего.

/** То, по чему лента узнаёт пару и что в ней видно. */
export interface TickerRow {
  symbol: string;
  price: number;
  change_pct: number;
  wall_notional: number;
}

/**
 * Свежие строки в прежнем порядке.
 *
 * Пара, что была и осталась, стоит там же. Выбывшую занимает новичок - по
 * порядку, в котором их прислал скринер. Новичков больше, чем выбывших, -
 * лишние встают в хвост; меньше - лента просто короче.
 */
export function keepOrder<T extends TickerRow>(prev: readonly T[], next: readonly T[]): T[] {
  if (!prev.length) return [...next];
  const fresh = new Map(next.map((row) => [row.symbol, row]));
  const known = new Set(prev.map((row) => row.symbol));
  const entrants = next.filter((row) => !known.has(row.symbol));

  let taken = 0;
  const kept: T[] = [];
  for (const old of prev) {
    const same = fresh.get(old.symbol);
    if (same) kept.push(same);
    else if (taken < entrants.length) kept.push(entrants[taken++]);
  }
  return [...kept, ...entrants.slice(taken)];
}

/**
 * Совпадают ли строки во всём, что видно в ленте.
 *
 * Скринер между опросами часто отвечает теми же цифрами, а новый массив -
 * это новая отрисовка обеих половин ленты. Одинаковое не перерисовываем.
 */
export function sameRows(a: readonly TickerRow[], b: readonly TickerRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => sameRow(row, b[i]));
}

export function sameRow(a: TickerRow, b: TickerRow): boolean {
  return (
    a.symbol === b.symbol &&
    a.price === b.price &&
    a.change_pct === b.change_pct &&
    a.wall_notional === b.wall_notional
  );
}
