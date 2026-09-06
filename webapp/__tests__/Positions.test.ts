import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { positionOf } from "@/lib/trading";
import { setStudentTokens, logout } from "@/lib/auth";

// В хедже по одному инструменту на бирже стоят две позиции — лонг и шорт.
// Терминал показывает результат каждой сделки отдельно, и перепутать их
// значит показать лонгу объём и прибыль шорта.

function answer(positions: Record<string, unknown>[]) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ positions }),
  })) as unknown as typeof fetch;
}

describe("позиция глазами биржи", () => {
  beforeEach(() => setStudentTokens("a1", "r1"));
  afterEach(() => {
    logout();
    vi.unstubAllGlobals();
  });

  it("выбирает сторону, когда позиций по инструменту две", async () => {
    vi.stubGlobal(
      "fetch",
      answer([
        { symbol: "BTCUSDT", positionSide: "LONG", total: "0.5", averageOpenPrice: "100" },
        { symbol: "BTCUSDT", positionSide: "SHORT", total: "0.2", averageOpenPrice: "110" },
      ]),
    );

    expect((await positionOf("BTCUSDT", "long"))?.size).toBe(0.5);
    expect((await positionOf("BTCUSDT", "short"))?.size).toBe(0.2);
  });

  it("в одностороннем режиме стороны в ответе нет - берём единственную позицию", async () => {
    vi.stubGlobal("fetch", answer([{ symbol: "BTCUSDT", total: "1.5" }]));
    expect((await positionOf("BTCUSDT", "long"))?.size).toBe(1.5);
    expect((await positionOf("BTCUSDT", "short"))?.size).toBe(1.5);
  });

  it("своей стороны нет - позиция пустая, а не чужая", async () => {
    vi.stubGlobal(
      "fetch",
      answer([{ symbol: "BTCUSDT", holdSide: "long", total: "0.5" }]),
    );
    // Шорта на бирже нет: показать ему объём лонга значит соврать о позиции,
    // которой не существует.
    expect((await positionOf("BTCUSDT", "short"))?.size).toBe(0);
  });

  it("чужой инструмент не считается своим", async () => {
    vi.stubGlobal("fetch", answer([{ symbol: "ETHUSDT", total: "3" }]));
    expect((await positionOf("BTCUSDT", "long"))?.size).toBe(0);
  });
});
