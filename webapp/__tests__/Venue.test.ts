import { describe, it, expect } from "vitest";
import { venueTitle } from "@/lib/exchanges";
import { cardFromShared, cardFromTrade } from "@/lib/pnl/data";
import type { JournalTrade } from "@/lib/journal";

// Карточка итога подписывается биржей, где открыта сделка: «WEEX Futures»
// под печатью. Терминал будет мультибиржевым - подпись идёт от кода биржи.

const trade: JournalTrade = {
  id: 1, client_id: "c1", symbol: "ETHUSDT", side: "long", entry: 2450, stop: 2440,
  exit_price: 2474.5, qty: 4, margin: 100, leverage: 100, takes_hit: 2, fee: 0.8,
  targets: [2460], outcome: "take", pnl: 97.2, opened_at: null,
  closed_at: "2026-09-11T10:00:00Z", note: "",
};

describe("подпись биржи на карточке", () => {
  it("по коду биржи", () => {
    expect(venueTitle("weex")).toBe("WEEX Futures");
    expect(venueTitle("BINANCE")).toBe("Binance Futures");
    expect(venueTitle("okx")).toBe("OKX Futures");
  });

  it("неизвестная или пустая - без подписи", () => {
    expect(venueTitle("")).toBe("");
    expect(venueTitle(undefined)).toBe("");
    expect(venueTitle("<script>")).toBe("");
  });

  it("сделка журнала несёт биржу на карточку", () => {
    expect(cardFromTrade({ ...trade, exchange: "weex" }).venue).toBe("WEEX Futures");
    // Учебная сделка без биржи подписи не получает.
    expect(cardFromTrade(trade).venue).toBeUndefined();
  });

  it("сделка из чата - тоже", () => {
    const shared = {
      symbol: "BTCUSDT", side: "short" as const, entry: 1, stop: 2, targets: [], qty: 1,
      leverage: 10, state: "open" as const, exchange: "weex",
    };
    expect(cardFromShared(shared, "2026-09-11T10:00:00Z").venue).toBe("WEEX Futures");
  });
});
