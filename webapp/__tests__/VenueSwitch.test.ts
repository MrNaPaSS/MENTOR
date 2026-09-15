import { describe, it, expect } from "vitest";
import { isVenueSwitch } from "@/lib/venueSwitch";

// После перезагрузки терминал уходил на биткоин сам: биржа до ответа сервера
// пустая, и появление настоящей принималось за смену счёта. Сбрасывать пару
// можно только при настоящей смене - с одной биржи на другую.

describe("смена биржи", () => {
  it("первое появление биржи - не смена", () => {
    expect(isVenueSwitch(null, "mexc")).toBe(false);
  });

  it("биржа приехала после пустой - тоже не смена", () => {
    expect(isVenueSwitch("", "mexc")).toBe(false);
  });

  it("та же биржа - не смена", () => {
    expect(isVenueSwitch("mexc", "mexc")).toBe(false);
  });

  it("с одной биржи на другую - смена", () => {
    expect(isVenueSwitch("weex", "mexc")).toBe(true);
  });

  it("счёт отключили - это не смена, пара остаётся", () => {
    expect(isVenueSwitch("mexc", "")).toBe(false);
  });
});
