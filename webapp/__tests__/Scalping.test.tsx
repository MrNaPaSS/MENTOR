import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DomTrader, { fmtPrice, fmtVol } from "@/components/scalping/DomTrader";
import Tape from "@/components/scalping/Tape";
import PressureBar from "@/components/scalping/PressureBar";
import { addTrades, emptyState } from "@/lib/clusters";
import type { DomSnapshot, DomLevel } from "@/lib/api";

function lvl(price: number, size: number, strong = false): DomLevel {
  return { price, size, cum: size, strong };
}

const snap: DomSnapshot = {
  symbol: "BTCUSDT",
  tick: 1,
  base_tick: 0.1,
  depth_available: { bids: 50, asks: 50 },
  bids: [lvl(100, 5, true), lvl(99, 2), lvl(98, 20)],
  asks: [lvl(101, 3), lvl(102, 1), lvl(103, 1)],
  best_bid: 100,
  best_ask: 101,
  mid: 100.5,
  spread: 1,
  spread_bp: 99.5,
  bid_volume: 27,
  ask_volume: 5,
  book_ratio: 0.84,
  bid_walls: [98],
  ask_walls: [],
  trades: [
    { price: 100.5, qty: 10, time: 1_700_000_000_000, isBuy: true },
    { price: 100.4, qty: 1, time: 1_700_000_001_000, isBuy: false },
  ],
  tape: { buy_volume: 10, sell_volume: 1, delta: 9, buy_ratio: 0.91 },
};

describe("fmtPrice", () => {
  it("берёт число знаков из шага агрегации", () => {
    expect(fmtPrice(100.5, 1)).toBe("101"); // шаг 1 → без дробной части
    expect(fmtPrice(100.55, 0.01)).toBe("100.55");
    expect(fmtPrice(0.12345, 0.0001)).toBe("0.1235");
  });

  it("не падает на нулевом шаге", () => {
    expect(() => fmtPrice(100, 0)).not.toThrow();
  });
});

describe("fmtVol", () => {
  it("пишет объёмы компактно, как в терминале", () => {
    expect(fmtVol(1_710_000)).toBe("1,71M");
    expect(fmtVol(917_000)).toBe("917K");
    expect(fmtVol(320)).toBe("320");
    expect(fmtVol(4.9)).toBe("4.9");
    expect(fmtVol(0.004)).toBe("0.004");
  });
});

describe("DomTrader", () => {
  it("строит строку на каждый ценовой уровень диапазона", () => {
    render(<DomTrader data={snap} buckets={[]} notional={false} />);
    // Цены от 98 до 103 с шагом 1 — шесть строк
    expect(screen.getAllByTestId("dom-trader-row")).toHaveLength(6);
  });

  it("на пустых данных показывает заглушку, а не падает", () => {
    const { container } = render(<DomTrader data={null} buckets={[]} />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("выделяет плиту золотым", () => {
    render(<DomTrader data={snap} buckets={[]} notional={false} />);
    expect(screen.getByText("98").className).toContain("accent-gold");
  });

  it("показывает колонки истории и подписи времени", () => {
    const state = addTrades(
      emptyState(),
      [{ price: 100, qty: 3, time: 1_700_000_000_000, isBuy: true }],
      { bucketMs: 300_000, tick: 1, maxBuckets: 12 },
    );
    render(<DomTrader data={snap} buckets={state.buckets} notional={false} />);
    // Объём кластера попал в свою ячейку
    expect(screen.getByTitle("покупки 3.0 / продажи 0.000")).toBeInTheDocument();
  });

  it("расширяет ценовую шкалу под кластеры вне стакана", () => {
    const state = addTrades(
      emptyState(),
      [{ price: 95, qty: 1, time: 1_700_000_000_000, isBuy: true }],
      { bucketMs: 300_000, tick: 1, maxBuckets: 12 },
    );
    render(<DomTrader data={snap} buckets={state.buckets} notional={false} />);
    // Диапазон 95..103 — девять строк вместо шести
    expect(screen.getAllByTestId("dom-trader-row")).toHaveLength(9);
  });
});

describe("Tape", () => {
  it("рисует строки сделок", () => {
    render(<Tape trades={snap.trades} tick={1} />);
    expect(screen.getAllByTestId("tape-row")).toHaveLength(2);
  });

  it("подсвечивает крупную сделку", () => {
    render(<Tape trades={snap.trades} tick={1} bigFactor={1.5} />);
    const rows = screen.getAllByTestId("tape-row");
    // Первая сделка (10) сильно выше средней (5.5) — фон подсвечен
    expect(rows[0].className).toContain("bg-success/10");
    expect(rows[1].className).not.toContain("bg-danger/10");
  });

  it("сообщает о пустой ленте", () => {
    render(<Tape trades={[]} tick={1} />);
    expect(screen.getByText("Лента пуста")).toBeInTheDocument();
  });

  it("ограничивает число строк", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      price: 100 + i,
      qty: 1,
      time: 1_700_000_000_000 + i,
      isBuy: true,
    }));
    render(<Tape trades={many} tick={1} rows={10} />);
    expect(screen.getAllByTestId("tape-row")).toHaveLength(10);
  });
});

describe("PressureBar", () => {
  it("переводит долю в проценты", () => {
    render(<PressureBar label="Перевес" ratio={0.84} left="27" right="5" />);
    expect(screen.getByText("84%")).toBeInTheDocument();
    expect(screen.getByTestId("pressure-fill").style.width).toBe("84%");
  });

  it("зажимает значения вне диапазона 0..1", () => {
    render(<PressureBar label="Перевес" ratio={2.5} left="a" right="b" />);
    expect(screen.getByTestId("pressure-fill").style.width).toBe("100%");
  });
});
