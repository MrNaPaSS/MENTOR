import { describe, it, expect } from "vitest";
import {
  addTrades,
  bucketStart,
  cellTotal,
  clusterPriceRange,
  emptyState,
  maxCell,
  snapPrice,
  topCells,
} from "@/lib/clusters";
import type { DomTrade } from "@/lib/api";

// Ровное начало минуты: 1_700_000_000_000 на минуту не делится.
const T0 = 1_699_999_980_000;

function trade(over: Partial<DomTrade> = {}): DomTrade {
  return { price: 100, qty: 1, time: T0, isBuy: true, ...over };
}

const OPTS = { bucketMs: 60_000, tick: 1, maxBuckets: 12 };

describe("bucketStart", () => {
  it("прижимает время к началу интервала", () => {
    expect(bucketStart(T0 + 45_000, 60_000)).toBe(T0);
    expect(bucketStart(T0 + 61_000, 60_000)).toBe(T0 + 60_000);
  });
});

describe("snapPrice", () => {
  it("приводит цену к шагу сетки", () => {
    expect(snapPrice(100.4, 1)).toBe(100);
    expect(snapPrice(100.6, 1)).toBe(101);
    expect(snapPrice(100.44, 0.1)).toBe(100.4);
  });

  it("при нулевом шаге отдаёт цену как есть", () => {
    expect(snapPrice(100.123, 0)).toBe(100.123);
  });
});

describe("addTrades", () => {
  it("складывает объём в ячейку по цене и времени", () => {
    const s = addTrades(emptyState(), [trade({ qty: 2 }), trade({ qty: 3 })], OPTS);
    expect(s.buckets).toHaveLength(1);
    expect(s.buckets[0].cells.get(100)).toEqual({ buy: 5, sell: 0 });
  });

  it("разделяет покупки и продажи", () => {
    const s = addTrades(emptyState(), [trade({ qty: 2 }), trade({ qty: 3, isBuy: false })], OPTS);
    expect(s.buckets[0].cells.get(100)).toEqual({ buy: 2, sell: 3 });
  });

  it("не считает одну сделку дважды", () => {
    // Соседние опросы возвращают пересекающиеся выборки — это норма для API.
    const t = trade({ qty: 4 });
    let s = addTrades(emptyState(), [t], OPTS);
    s = addTrades(s, [t, trade({ qty: 4, time: T0 + 1 })], OPTS);
    expect(cellTotal(s.buckets[0].cells.get(100)!)).toBe(8);
  });

  it("раскладывает сделки по разным столбцам времени", () => {
    const s = addTrades(
      emptyState(),
      [trade(), trade({ time: T0 + 60_000, qty: 2 })],
      OPTS,
    );
    expect(s.buckets.map((b) => b.start)).toEqual([T0, T0 + 60_000]);
  });

  it("держит столбцы в хронологическом порядке", () => {
    const s = addTrades(
      emptyState(),
      [trade({ time: T0 + 120_000 }), trade({ time: T0 })],
      OPTS,
    );
    expect(s.buckets[0].start).toBeLessThan(s.buckets[1].start);
  });

  it("обрезает историю до maxBuckets", () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      trade({ time: T0 + i * 60_000, qty: 1 }),
    );
    const s = addTrades(emptyState(), trades, { ...OPTS, maxBuckets: 5 });
    expect(s.buckets).toHaveLength(5);
    // Остаться должны свежие, а не первые попавшиеся
    expect(s.buckets[4].start).toBe(T0 + 19 * 60_000);
  });

  it("чистит ключи выпавших интервалов, чтобы память не росла", () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      trade({ time: T0 + i * 60_000 }),
    );
    const s = addTrades(emptyState(), trades, { ...OPTS, maxBuckets: 3 });
    expect(s.seen.size).toBeLessThanOrEqual(3);
  });

  it("не мутирует прежнее состояние", () => {
    const before = addTrades(emptyState(), [trade({ qty: 1 })], OPTS);
    const after = addTrades(before, [trade({ qty: 1, time: T0 + 5 })], OPTS);
    expect(cellTotal(before.buckets[0].cells.get(100)!)).toBe(1);
    expect(cellTotal(after.buckets[0].cells.get(100)!)).toBe(2);
  });

  it("группирует близкие цены по шагу сетки", () => {
    const s = addTrades(
      emptyState(),
      [trade({ price: 100.2 }), trade({ price: 100.4, time: T0 + 1 })],
      OPTS,
    );
    expect(s.buckets[0].cells.size).toBe(1);
  });
});

describe("maxCell / topCells", () => {
  const state = addTrades(
    emptyState(),
    [
      trade({ price: 100, qty: 1 }),
      trade({ price: 101, qty: 9, time: T0 + 1 }),
      trade({ price: 102, qty: 5, time: T0 + 2 }),
    ],
    OPTS,
  );

  it("находит максимальную ячейку", () => {
    expect(maxCell(state.buckets)).toBe(9);
    expect(maxCell([])).toBe(0);
  });

  it("отмечает крупнейшие кластеры", () => {
    const top = topCells(state.buckets, 1);
    expect(top.has(`${T0}:101`)).toBe(true);
    expect(top.has(`${T0}:100`)).toBe(false);
  });
});

describe("clusterPriceRange", () => {
  it("отдаёт границы цен по всем столбцам", () => {
    const s = addTrades(
      emptyState(),
      [trade({ price: 98 }), trade({ price: 105, time: T0 + 1 })],
      OPTS,
    );
    expect(clusterPriceRange(s.buckets)).toEqual({ min: 98, max: 105 });
  });

  it("на пустой истории отдаёт null, а не Infinity", () => {
    expect(clusterPriceRange([])).toBeNull();
  });
});
