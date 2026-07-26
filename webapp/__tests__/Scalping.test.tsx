import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DomLadder, { fmtPrice, fmtSize } from "@/components/scalping/DomLadder";
import Tape from "@/components/scalping/Tape";
import PressureBar from "@/components/scalping/PressureBar";
import { priceBounds, maxLevelSize } from "@/components/scalping/LiquidityHeatmap";
import type { DomSnapshot, DomLevel } from "@/lib/api";

function lvl(price: number, size: number, strong = false): DomLevel {
  return { price, size, cum: size, strong };
}

const snap: DomSnapshot = {
  symbol: "BTCUSDT",
  tick: 1,
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

describe("fmtSize", () => {
  it("сжимает крупные объёмы", () => {
    expect(fmtSize(1_500_000)).toBe("1.50M");
    expect(fmtSize(2_400)).toBe("2.4K");
    expect(fmtSize(12.34)).toBe("12.3");
    expect(fmtSize(0.5)).toBe("0.500");
  });
});

describe("DomLadder", () => {
  it("рисует обе стороны стакана", () => {
    render(<DomLadder data={snap} />);
    expect(screen.getAllByTestId("dom-row-bid")).toHaveLength(3);
    expect(screen.getAllByTestId("dom-row-ask")).toHaveLength(3);
  });

  it("показывает спред между сторонами", () => {
    render(<DomLadder data={snap} />);
    expect(screen.getByText("спред")).toBeInTheDocument();
    expect(screen.getByText("99.5 б.п.")).toBeInTheDocument();
  });

  it("на пустых данных показывает заглушку, а не падает", () => {
    const { container } = render(<DomLadder data={null} />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("выделяет плиту золотым", () => {
    render(<DomLadder data={snap} />);
    // Цена 98 помечена как плита в bid_walls
    const wall = screen.getByText("98");
    expect(wall.className).toContain("accent-gold");
  });

  it("не подсвечивает плиты при showWalls=false", () => {
    render(<DomLadder data={snap} showWalls={false} />);
    expect(screen.getByText("98").className).not.toContain("accent-gold");
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

describe("LiquidityHeatmap helpers", () => {
  it("находит границы цен по всей истории", () => {
    expect(priceBounds([snap])).toEqual({ min: 98, max: 103 });
  });

  it("на пустой истории отдаёт нули вместо Infinity", () => {
    expect(priceBounds([])).toEqual({ min: 0, max: 0 });
  });

  it("находит максимальный объём уровня", () => {
    expect(maxLevelSize([snap])).toBe(20);
    expect(maxLevelSize([])).toBe(0);
  });
});
