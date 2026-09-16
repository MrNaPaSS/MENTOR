import { describe, it, expect } from "vitest";
import { refreshFor } from "@/components/scalping/PriceChart";

// На минутке свеча меняется каждые секунды, на дневке - раз в сутки. Опрос
// раз в пять секунд на крупном таймфрейме это сотни походов на биржу за день
// без единой новой свечи.

describe("как часто спрашивать свечи", () => {
  it("мелкие таймфреймы обновляются часто", () => {
    expect(refreshFor("1m")).toBe(5000);
    expect(refreshFor("15m")).toBe(5000);
  });

  it("от часа и крупнее - реже", () => {
    expect(refreshFor("1h")).toBe(30_000);
    expect(refreshFor("12h")).toBe(30_000);
    expect(refreshFor("1d")).toBe(30_000);
  });

  it("незнакомый таймфрейм считается мелким", () => {
    expect(refreshFor("что-то")).toBe(5000);
  });
});
