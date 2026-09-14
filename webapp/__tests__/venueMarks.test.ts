import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { venueMark } from "@/lib/venueMarks";

// Биржи, на которых терминал уже торгует (core/venues.py, trading=True).
// Знак у такой биржи обязан быть: без него она показывается голым текстом
// там, где остальные показаны картинкой.
const TRADING = ["weex", "okx", "bingx", "mexc", "binance"];

describe("venueMark", () => {
  it("знает каждую биржу, на которой терминал торгует", () => {
    for (const code of TRADING) {
      expect(venueMark(code), code).not.toBeNull();
    }
  });

  it("файл знака лежит на месте", () => {
    for (const code of TRADING) {
      const src = venueMark(code)!.src;
      expect(existsSync(join(process.cwd(), "public", src)), src).toBe(true);
    }
  });

  it("код биржи приходит в разном написании", () => {
    expect(venueMark("BingX")?.src).toBe(venueMark("bingx")?.src);
    expect(venueMark(" MEXC ")?.src).toBe(venueMark("mexc")?.src);
  });

  it("незнакомая биржа знака не получает", () => {
    expect(venueMark("bybit")).toBeNull();
    expect(venueMark("")).toBeNull();
    expect(venueMark(null)).toBeNull();
  });
});
