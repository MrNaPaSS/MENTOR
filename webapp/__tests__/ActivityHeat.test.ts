/**
 * Карта торговли: клетка - день, насыщенность - число сделок.
 *
 * Проверяется то, ради чего карта и делалась: она показывает режим работы, а
 * не выдумывает его. День без сделок остаётся пустым всегда, а уровни
 * считаются от самого плотного дня самого трейдера - у скальпера двадцать
 * сделок в день будни, у свингера три уже много.
 */

import { describe, it, expect } from "vitest";

import { busiestDay, dayKey, heatDays, heatLevel } from "@/lib/activity";
import type { JournalRow } from "@/components/scalping/JournalTable";

function trade(closed: string, pnl = 10): JournalRow {
  return {
    id: 1,
    client_id: `t-${closed}-${pnl}`,
    symbol: "BTCUSDT",
    side: "long",
    entry: 100,
    stop: 90,
    exit_price: 110,
    qty: 1,
    margin: 100,
    leverage: 10,
    takes_hit: 1,
    fee: 0.1,
    targets: [110],
    outcome: "take",
    pnl,
    opened_at: closed,
    closed_at: closed,
    note: "",
  } as JournalRow;
}

describe("клетки карты", () => {
  const now = new Date(2026, 8, 17); // 17 сентября 2026, четверг

  it("идут подряд и кончаются сегодняшним днём", () => {
    const cells = heatDays([], 14, now);
    expect(cells.at(-1)!.key).toBe(dayKey(now));
    // Начинается с понедельника: столбец карты - это неделя.
    expect(cells[0].at.getDay()).toBe(1);
  });

  it("считают сделки и итог дня", () => {
    const cells = heatDays(
      [
        trade("2026-09-16T10:00:00", 20),
        trade("2026-09-16T14:00:00", -5),
        trade("2026-09-15T11:00:00", 7),
      ],
      14,
      now,
    );
    const sixteenth = cells.find((one) => one.key === "2026-09-16")!;
    expect(sixteenth.trades).toBe(2);
    expect(sixteenth.pnl).toBeCloseTo(15, 6);
    expect(cells.find((one) => one.key === "2026-09-15")!.trades).toBe(1);
  });

  it("сделки вне окна карты в неё не попадают", () => {
    const cells = heatDays([trade("2026-01-05T10:00:00")], 14, now);
    expect(cells.every((one) => one.trades === 0)).toBe(true);
  });
});

describe("насыщенность клетки", () => {
  it("день без сделок остаётся пустым", () => {
    expect(heatLevel(0, 20)).toBe(0);
  });

  it("растёт от доли к самому плотному дню", () => {
    expect(heatLevel(2, 20)).toBe(1);
    expect(heatLevel(9, 20)).toBe(2);
    expect(heatLevel(14, 20)).toBe(3);
    expect(heatLevel(20, 20)).toBe(4);
  });

  it("единственная сделка за всё время красится полностью", () => {
    expect(heatLevel(1, 1)).toBe(4);
  });

  it("самый плотный день находится по всей карте", () => {
    const cells = heatDays(
      [
        trade("2026-09-16T10:00:00"),
        trade("2026-09-16T11:00:00"),
        trade("2026-09-15T10:00:00"),
      ],
      14,
      new Date(2026, 8, 17),
    );
    expect(busiestDay(cells)).toBe(2);
  });
});
