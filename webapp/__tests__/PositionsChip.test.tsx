import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PositionsChip from "@/components/scalping/PositionsChip";
import { createTrade, type ActiveTrade } from "@/lib/trade/position";

// Окно позиций - единственное место, где видны сделки по всем монетам разом.
// Соврать в нём о числе или о взятых целях значит отправить трейдера не на тот
// график или заставить думать, что цель ещё впереди.

function trade(
  id: string,
  symbol: string,
  side: "long" | "short",
  over: Partial<ActiveTrade> = {},
): ActiveTrade {
  const long = side === "long";
  return {
    ...createTrade(
      {
        symbol,
        side,
        entry: 100,
        stop: long ? 99 : 101,
        targets: long ? [101, 102, 103] : [99, 98, 97],
        qty: 10,
        margin: 100,
        leverage: 20,
      },
      id,
    ),
    ...over,
  };
}

function chip(trades: ActiveTrade[], onPick = vi.fn()) {
  render(<PositionsChip trades={trades} current="BTCUSDT" className="" onPick={onPick} />);
  return onPick;
}

describe("кнопка позиций", () => {
  it("считает и открытые позиции, и лимитки", () => {
    chip([
      trade("a", "BTCUSDT", "long", { status: "open" }),
      trade("b", "ETHUSDT", "short"),
    ]);
    expect(screen.getByRole("button").textContent).toBe("позиции 2");
  });

  it("в окне пара, сторона, плечо и взятые цели", () => {
    chip([trade("a", "ETHUSDT", "short", { status: "open", takesHit: 1, leverage: 200 })]);
    fireEvent.click(screen.getByRole("button"));

    const row = screen.getByTitle("Открыть график ETHUSDT");
    expect(row.textContent).toContain("ETHUSDT");
    expect(row.textContent).toContain("активный");
    expect(row.textContent).toContain("шорт");
    expect(row.textContent).toContain("×200");
    // Три цели, одна взята.
    expect(row.querySelectorAll("[data-taken]")).toHaveLength(3);
    expect(row.querySelectorAll('[data-taken="true"]')).toHaveLength(1);
  });

  it("ждущая входа помечена «ожидаем», у неё ни одной взятой цели", () => {
    chip([trade("b", "SOLUSDT", "long")]);
    fireEvent.click(screen.getByRole("button"));

    const row = screen.getByTitle("Открыть график SOLUSDT");
    expect(row.textContent).toContain("ожидаем");
    expect(row.textContent).not.toContain("активный");
    expect(row.querySelectorAll('[data-taken="true"]')).toHaveLength(0);
  });

  it("нажатие на пару открывает её график и закрывает окно", () => {
    const onPick = chip([trade("a", "ETHUSDT", "short", { status: "open" })]);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByTitle("Открыть график ETHUSDT"));

    expect(onPick).toHaveBeenCalledWith("ETHUSDT");
    expect(screen.queryByTitle("Открыть график ETHUSDT")).toBeNull();
  });

  it("открытые позиции стоят выше лимиток", () => {
    chip([
      trade("b", "AAAUSDT", "long"),
      trade("a", "ZZZUSDT", "long", { status: "open" }),
    ]);
    fireEvent.click(screen.getByRole("button"));

    const titles = screen
      .getAllByTitle(/Открыть график/)
      .map((el) => el.getAttribute("title"));
    expect(titles).toEqual(["Открыть график ZZZUSDT", "Открыть график AAAUSDT"]);
  });
});
