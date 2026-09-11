import { describe, it, expect } from "vitest";
import { journalStats } from "@/lib/journalStats";
import { journalReport } from "@/lib/journalReport";
import { ru } from "@/lib/i18n/dict/ru";
import type { JournalTrade } from "@/lib/journal";

// Выгрузка журнала - отчёт с диаграммами. Числа в нём должны сходиться с
// журналом, а строка из заметки не должна стать разметкой.

let seq = 0;
function trade(pnl: number, over: Partial<JournalTrade> = {}): JournalTrade {
  seq += 1;
  return {
    id: seq,
    client_id: `t${seq}`,
    symbol: "BTCUSDT",
    side: "long",
    entry: 100,
    stop: 95,
    exit_price: 100 + pnl,
    qty: 1,
    margin: 10,
    leverage: 10,
    takes_hit: 0,
    fee: 0.1,
    targets: [110],
    outcome: pnl > 0 ? "take" : "stop",
    pnl,
    opened_at: null,
    closed_at: new Date(Date.UTC(2026, 8, 1, 10, seq)).toISOString(),
    note: "",
    ...over,
  };
}

describe("статистика журнала", () => {
  const trades = [trade(10), trade(-4), trade(6), trade(-8), trade(0)];
  const s = journalStats(trades);

  it("сделки, винрейт без безубытка", () => {
    expect(s.count).toBe(5);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.flat).toBe(1);
    expect(s.winRate).toBe(50);
  });

  it("итог, профит-фактор, средние", () => {
    expect(s.pnl).toBe(4);
    expect(s.profitFactor).toBe(1.33);
    expect(s.avgWin).toBe(8);
    expect(s.avgLoss).toBe(-6);
    expect(s.fees).toBe(0.5);
  });

  it("просадка - от пика кривой капитала", () => {
    // Кривая: 10, 6, 12, 4, 4. Пик 12, дно после него 4.
    expect(s.equity.map((p) => p.value)).toEqual([10, 6, 12, 4, 4]);
    expect(s.maxDrawdown).toBe(8);
  });

  it("серии, исходы, стороны", () => {
    expect(s.longestWinStreak).toBe(1);
    expect(s.longestLossStreak).toBe(1);
    expect(s.outcomes).toEqual({ take: 2, stop: 3, manual: 0 });
    expect(s.long.count).toBe(5);
    expect(s.short.count).toBe(0);
  });

  it("без убытков профит-фактора нет, а не бесконечность в числе", () => {
    expect(journalStats([trade(5)]).profitFactor).toBeNull();
  });
});

describe("отчёт по журналу", () => {
  const text = ru.journal.report;

  it("самодостаточный документ с диаграммами и таблицей", () => {
    const html = journalReport([trade(10), trade(-4), trade(6, { symbol: "ETHUSDT", side: "short" })], {
      text,
      quota: { used: 1, limit: 3 },
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(text.equity);
    expect(html).toContain(text.symbols);
    expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("<tbody>");
    expect(html).toContain("выгрузка 1 из 3");
    // Внешних ресурсов нет: файл открывают без интернета.
    expect(html).not.toMatch(/<link|<script src|https?:\/\//);
  });

  it("CSV лежит внутри файла", () => {
    const html = journalReport([trade(3)], { text });
    expect(html).toContain('href="data:text/csv;charset=utf-8,');
  });

  it("строка из данных не становится разметкой", () => {
    const html = journalReport([trade(3, { symbol: '<img src=x onerror="alert(1)">' })], { text });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("пустой период - честная надпись, а не пустые диаграммы", () => {
    const html = journalReport([], { text });
    expect(html).toContain(text.empty);
    expect(html).not.toContain("<svg");
  });
});
