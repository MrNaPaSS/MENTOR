import { describe, it, expect } from "vitest";
import { allowedAgg, allowedRows, VISION_LAYERS } from "@/lib/tools";

// Инструменты маркета: что открыто всем, а что за покупку.

describe("бесплатный уровень терминала", () => {
  it("EMA, полки и объём - у всех, в NMNH VISION их нет", () => {
    const paid: readonly string[] = VISION_LAYERS;
    expect(paid).not.toContain("ema");
    expect(paid).not.toContain("shelves");
    expect(paid).not.toContain("volume");
    expect(paid).toEqual(["trend", "structure", "blocks", "gaps", "zones"]);
  });

  it("без покупки - 30 строк и шаг не крупнее ×10", () => {
    expect(allowedRows(100, false)).toBe(30);
    expect(allowedRows(30, false)).toBe(30);
    expect(allowedAgg(25, false)).toBe(10);
    expect(allowedAgg(5, false)).toBe(5);
  });

  it("купленное отдаётся как выбрано", () => {
    expect(allowedRows(100, true)).toBe(100);
    expect(allowedAgg(25, true)).toBe(25);
  });
});
