import { describe, expect, it } from "vitest";
import {
  buildTiles,
  formatChange,
  intensity,
  MAX_TILES,
  tileColor,
  toneOf,
  type HeatmapTicker,
} from "@/lib/heatmap";

function row(symbol: string, change: string, volume: string): HeatmapTicker {
  return { symbol, price: "1", priceChangePercent: change, quoteVolume: volume };
}

describe("buildTiles", () => {
  it("puts the most traded pairs first", () => {
    const tiles = buildTiles([
      row("ADAUSDT", "1", "1000"),
      row("BTCUSDT", "1", "900000"),
      row("ETHUSDT", "1", "50000"),
    ]);
    expect(tiles.map((t) => t.symbol)).toEqual(["BTCUSDT", "ETHUSDT", "ADAUSDT"]);
  });

  it("shortens the pair for the tile label", () => {
    expect(buildTiles([row("BTCUSDT", "1", "10")])[0].base).toBe("BTC");
  });

  it("drops pairs with no turnover: a zero tile is not drawn anyway", () => {
    const tiles = buildTiles([row("BTCUSDT", "1", "10"), row("DEADUSDT", "0", "0")]);
    expect(tiles.map((t) => t.symbol)).toEqual(["BTCUSDT"]);
  });

  it("keeps at most forty tiles so labels stay readable on a phone", () => {
    const many = Array.from({ length: 60 }, (_, i) => row(`C${i}USDT`, "1", String(60 - i)));
    expect(buildTiles(many)).toHaveLength(MAX_TILES);
  });

  it("survives a backend that still sends zero percent", () => {
    const tiles = buildTiles([row("BTCUSDT", "0", "10")]);
    expect(tiles[0].change).toBe(0);
  });

  it("survives missing turnover and unparsable numbers", () => {
    const tiles = buildTiles([
      { symbol: "BTCUSDT", price: "x", priceChangePercent: "y" },
      row("ETHUSDT", "1", "5"),
    ]);
    expect(tiles.map((t) => t.symbol)).toEqual(["ETHUSDT"]);
  });
});

describe("colour by change", () => {
  it("splits growth, fall and standing still", () => {
    expect(toneOf(2)).toBe("up");
    expect(toneOf(-2)).toBe("down");
    expect(toneOf(0.01)).toBe("flat");
  });

  it("saturates proportionally and stops at five percent", () => {
    expect(intensity(0)).toBe(0);
    expect(intensity(2.5)).toBe(0.5);
    expect(intensity(5)).toBe(1);
    expect(intensity(40)).toBe(1);
  });

  it("paints growth and fall with our own theme tokens", () => {
    expect(tileColor(3)).toContain("--pane-up");
    expect(tileColor(-3)).toContain("--pane-down");
    // Обе темы получаются сами: цвет не задан числом.
    expect(tileColor(3)).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("leaves a standing price without colour", () => {
    expect(tileColor(0)).toBe("var(--pane-border)");
  });
});

describe("formatChange", () => {
  it("keeps the sign visible", () => {
    expect(formatChange(1.238)).toBe("+1.24%");
    expect(formatChange(-0.5)).toBe("-0.50%");
    expect(formatChange(0)).toBe("0.00%");
  });
});
