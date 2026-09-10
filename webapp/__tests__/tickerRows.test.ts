import { describe, expect, it } from "vitest";
import { keepOrder, sameRows, type TickerRow } from "@/lib/tickerRows";

function row(symbol: string, price = 1): TickerRow {
  return { symbol, price, change_pct: 0, wall_notional: 0 };
}

const syms = (rows: TickerRow[]) => rows.map((r) => r.symbol);

describe("keepOrder", () => {
  it("first load takes the screener order", () => {
    expect(syms(keepOrder([], [row("B"), row("A")]))).toEqual(["B", "A"]);
  });

  it("keeps old positions when the screener reshuffles", () => {
    const prev = [row("A"), row("B"), row("C")];
    const next = [row("C", 3), row("A", 2), row("B", 5)];
    const merged = keepOrder(prev, next);
    expect(syms(merged)).toEqual(["A", "B", "C"]);
    expect(merged.map((r) => r.price)).toEqual([2, 5, 3]);
  });

  it("puts a newcomer in the slot of the one that dropped out", () => {
    const prev = [row("A"), row("B"), row("C")];
    const next = [row("C"), row("D"), row("A")];
    expect(syms(keepOrder(prev, next))).toEqual(["A", "D", "C"]);
  });

  it("appends extra newcomers and shrinks when the list is shorter", () => {
    expect(syms(keepOrder([row("A")], [row("B"), row("A"), row("C")]))).toEqual(["A", "B", "C"]);
    expect(syms(keepOrder([row("A"), row("B"), row("C")], [row("B")]))).toEqual(["B"]);
  });
});

describe("sameRows", () => {
  it("ignores new arrays with the same numbers", () => {
    expect(sameRows([row("A", 1)], [row("A", 1)])).toBe(true);
  });

  it("notices a moved price or a different length", () => {
    expect(sameRows([row("A", 1)], [row("A", 2)])).toBe(false);
    expect(sameRows([row("A")], [row("A"), row("B")])).toBe(false);
  });
});
