import { describe, it, expect } from "vitest";
import { createTrade, spreadTakes, type ActiveTrade } from "@/lib/trade/position";

// Перенос цели мышью: что рисовать после ответа биржи.
//
// Раньше в ответе брали одну цену по номеру цели, и стоило перетащить цель
// через соседнюю, как номера у нас и на бирже расходились: линия вставала на
// цену чужой цели и стояла так до следующего опроса - «поставилось не туда, а
// через время само переехало куда вели».

function trade(side: "long" | "short", targets: number[], hit = 0): ActiveTrade {
  return {
    ...createTrade(
      {
        symbol: "BTCUSDT",
        side,
        entry: 80_000,
        stop: 79_900,
        targets,
        qty: 0.03,
        margin: 100,
        leverage: 10,
      },
      "BTCUSDT-1",
    ),
    status: "open",
    takesHit: hit,
  };
}

describe("цели после переноса", () => {
  it("раскладывает весь ряд от ближней к дальней", () => {
    // Первую цель утащили выше второй: на бирже теперь 80 400, 80 500, 80 600.
    const next = spreadTakes(trade("long", [80_200, 80_400, 80_600]), 0, 80_500, [
      80_500, 80_400, 80_600,
    ]);
    expect(next.targets).toEqual([80_400, 80_500, 80_600]);
  });

  it("у шорта ближняя цель - верхняя", () => {
    const next = spreadTakes(trade("short", [79_800, 79_600, 79_400]), 2, 79_700, [
      79_800, 79_600, 79_700,
    ]);
    expect(next.targets).toEqual([79_800, 79_700, 79_600]);
  });

  it("взятые цели остаются на своих местах", () => {
    const next = spreadTakes(trade("long", [80_200, 80_400, 80_600], 1), 1, 80_900, [
      80_900, 80_400,
    ]);
    expect(next.targets).toEqual([80_200, 80_400, 80_900]);
  });

  it("ряд короче замысла - двигаем только ту цель, что тянули", () => {
    // Одна из целей на бирже не стоит: раскладывать не по чему, и подставить
    // две цены на три цели значит соврать о том, какая из них где.
    const next = spreadTakes(trade("long", [80_200, 80_400, 80_600]), 2, 80_900, [
      80_200, 80_950,
    ]);
    expect(next.targets).toEqual([80_200, 80_400, 80_950]);
  });

  it("биржа не назвала ни одной цены - остаётся то, куда дотянули", () => {
    const next = spreadTakes(trade("long", [80_200, 80_400]), 1, 80_800, []);
    expect(next.targets).toEqual([80_200, 80_800]);
  });

  it("сделку не мутирует", () => {
    const before = trade("long", [80_200, 80_400]);
    const targets = before.targets;
    spreadTakes(before, 0, 80_500, [80_500, 80_400]);
    expect(before.targets).toBe(targets);
    expect(before.targets).toEqual([80_200, 80_400]);
  });
});
