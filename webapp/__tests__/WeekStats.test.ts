/**
 * Цифры недели под планом.
 *
 * Проверяется главное свойство этих цифр: они не додумывают за трейдера.
 * Неотмеченная сделка не идёт ни в «по плану», ни в «нарушения», а сделки
 * чужой недели не попадают в итог, даже если лежат в том же списке.
 */

import { describe, it, expect } from "vitest";

import { weekStats } from "@/lib/weekStats";
import type { JournalRow } from "@/components/scalping/JournalTable";

function trade(over: Partial<JournalRow> = {}): JournalRow {
  return {
    id: 1,
    client_id: "a",
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
    pnl: 10,
    opened_at: "2026-09-15T10:00:00Z",
    closed_at: "2026-09-15T11:00:00Z",
    note: "",
    ...over,
  } as JournalRow;
}

describe("цифры недели", () => {
  it("берёт только закрытые сделки своей недели", () => {
    const rows = [
      trade({ client_id: "a" }),
      // Неделей раньше: в итог этой недели не идёт.
      trade({ client_id: "b", closed_at: "2026-09-08T11:00:00Z", pnl: 100 }),
      // Идущая: итога у неё ещё нет.
      trade({ client_id: "c", closed_at: null, pnl: 5 } as Partial<JournalRow>),
    ];
    const week = weekStats(rows, "2026-W38");
    expect(week.trades).toBe(1);
    expect(week.pnl).toBe(10);
  });

  it("дисциплину считает только по отметкам", () => {
    const rows = [
      trade({ client_id: "a", plan_ok: true }),
      trade({ client_id: "b", plan_ok: false }),
      // Не отмечена: ни в плюс дисциплине, ни в минус.
      trade({ client_id: "c" }),
    ];
    const week = weekStats(rows, "2026-W38");
    expect(week.trades).toBe(3);
    expect(week.marked).toBe(2);
    expect(week.planned).toBe(1);
    expect(week.breaks).toBe(1);
  });

  it("winrate и процент считает от того, что было", () => {
    const rows = [
      trade({ client_id: "a", pnl: 20, margin: 100 }),
      trade({ client_id: "b", pnl: -10, margin: 100 }),
    ];
    const week = weekStats(rows, "2026-W38");
    expect(week.wins).toBe(1);
    expect(week.winrate).toBeCloseTo(0.5, 6);
    expect(week.gain).toBeCloseTo(5, 6);
  });

  it("пустую неделю не выдаёт за нулевую", () => {
    const week = weekStats([], "2026-W38");
    expect(week.trades).toBe(0);
    expect(week.winrate).toBeNull();
    expect(week.gain).toBeNull();
  });
});
