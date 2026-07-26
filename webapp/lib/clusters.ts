// Накопление кластеров объёма по времени и цене — данные для колонок слева
// от стакана (как в DOM Trader: 14:30, 14:35, ... по ценовым строкам).
//
// История строится с момента открытия страницы: WEEX отдаёт только последние
// сделки, эндпоинта «объём по ценам за прошлые часы» у биржи нет.

import type { DomTrade } from "./api";

export interface Cell {
  buy: number;
  sell: number;
}

export interface Bucket {
  /** Начало временного интервала, мс. */
  start: number;
  /** Объём по ценовым уровням: ключ — цена, приведённая к шагу. */
  cells: Map<number, Cell>;
}

export interface ClusterState {
  buckets: Bucket[];
  /** Ключи уже учтённых сделок — опрос отдаёт пересекающиеся выборки. */
  seen: Set<string>;
}

export function emptyState(): ClusterState {
  return { buckets: [], seen: new Set() };
}

export function tradeKey(t: DomTrade): string {
  return `${t.time}:${t.price}:${t.qty}`;
}

/** Начало интервала, в который попадает момент времени. */
export function bucketStart(timeMs: number, bucketMs: number): number {
  return Math.floor(timeMs / bucketMs) * bucketMs;
}

/** Цена, приведённая к шагу ценовой сетки. */
export function snapPrice(price: number, tick: number): number {
  if (tick <= 0) return price;
  return Math.round(Math.round(price / tick) * tick * 1e8) / 1e8;
}

/**
 * Добавить сделки в накопитель.
 *
 * Возвращает новое состояние — так React увидит изменение по ссылке.
 * Дубли отсекаются по ключу: соседние опросы возвращают одни и те же сделки.
 */
export function addTrades(
  state: ClusterState,
  trades: DomTrade[],
  opts: { bucketMs: number; tick: number; maxBuckets: number },
): ClusterState {
  const { bucketMs, tick, maxBuckets } = opts;
  // Ячейки копируем поштучно: клонировать только Map недостаточно —
  // объекты внутри остались бы общими, и прошлое состояние мутировало бы.
  const buckets = state.buckets.map((b) => ({
    start: b.start,
    cells: new Map<number, Cell>(Array.from(b.cells, ([price, c]) => [price, { ...c }])),
  }));
  const seen = new Set(state.seen);
  const byStart = new Map(buckets.map((b) => [b.start, b]));

  for (const t of trades) {
    const key = tradeKey(t);
    if (seen.has(key)) continue;
    seen.add(key);

    const start = bucketStart(t.time, bucketMs);
    let bucket = byStart.get(start);
    if (!bucket) {
      bucket = { start, cells: new Map() };
      byStart.set(start, bucket);
      buckets.push(bucket);
    }

    const price = snapPrice(t.price, tick);
    const cell = bucket.cells.get(price) ?? { buy: 0, sell: 0 };
    if (t.isBuy) cell.buy += t.qty;
    else cell.sell += t.qty;
    bucket.cells.set(price, cell);
  }

  buckets.sort((a, b) => a.start - b.start);
  const kept = buckets.slice(-maxBuckets);

  // Ключи отброшенных интервалов больше не нужны — иначе Set растёт вечно.
  if (kept.length < buckets.length) {
    const oldest = kept.length ? kept[0].start : Infinity;
    for (const key of seen) {
      const time = Number(key.split(":")[0]);
      if (time < oldest) seen.delete(key);
    }
  }

  return { buckets: kept, seen };
}

/** Суммарный объём ячейки. */
export function cellTotal(c: Cell): number {
  return c.buy + c.sell;
}

/** Максимальный объём ячейки по всем интервалам — нормировка яркости. */
export function maxCell(buckets: Bucket[]): number {
  let max = 0;
  for (const b of buckets) {
    for (const c of b.cells.values()) {
      const total = cellTotal(c);
      if (total > max) max = total;
    }
  }
  return max;
}

/**
 * Цены крупнейших кластеров — их выделяем отдельным цветом,
 * как оранжевые ячейки в Tiger.Trade.
 */
export function topCells(buckets: Bucket[], count = 8): Set<string> {
  const all: { key: string; total: number }[] = [];
  for (const b of buckets) {
    for (const [price, c] of b.cells) {
      all.push({ key: `${b.start}:${price}`, total: cellTotal(c) });
    }
  }
  all.sort((a, b) => b.total - a.total);
  return new Set(all.slice(0, count).map((x) => x.key));
}

/** Ценовой диапазон, покрытый кластерами. */
export function clusterPriceRange(buckets: Bucket[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const b of buckets) {
    for (const price of b.cells.keys()) {
      if (price < min) min = price;
      if (price > max) max = price;
    }
  }
  if (!isFinite(min) || !isFinite(max)) return null;
  return { min, max };
}
