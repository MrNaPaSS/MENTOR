/**
 * Этап снимка и короткая справка под ним.
 *
 * Этапов три, но снимки накопились раньше, чем они появились: у половины
 * этапа нет вовсе. Терять их нельзя - они и есть разбор, - поэтому этап у
 * таких снимков берётся из подписи, которую терминал писал сам: «цель 1»,
 * «закрытие».
 */

import { describe, it, expect } from "vitest";

import { stageOf } from "@/lib/journalShots";
import { shotBrief } from "@/components/scalping/TradeShots";
import type { JournalRow } from "@/components/scalping/JournalTable";
import type { Dict } from "@/lib/i18n";

const t = {
  journal: {
    long: "Лонг",
    short: "Шорт",
    liveNone: "целей пока нет",
  },
} as unknown as Dict;

function trade(over: Partial<JournalRow> = {}): JournalRow {
  return {
    id: 1,
    client_id: "a",
    symbol: "BTCUSDT",
    side: "short",
    entry: 76686.9,
    stop: 76763.6,
    exit_price: 76558.27,
    qty: 2.608,
    margin: 100,
    leverage: 200,
    takes_hit: 2,
    fee: 127.84,
    targets: [76610.2131, 76533.5262, 76495.8],
    outcome: "take",
    pnl: 207.63,
    opened_at: "2026-09-17T20:24:00Z",
    closed_at: "2026-09-17T21:02:00Z",
    note: "",
    ...over,
  } as JournalRow;
}

describe("этап снимка", () => {
  it("имена этапов читаются как есть", () => {
    expect(stageOf("manage")).toBe("manage");
    expect(stageOf("exit")).toBe("exit");
    expect(stageOf("entry")).toBe("entry");
  });

  it("старые имена переводятся в нынешние три", () => {
    expect(stageOf("before")).toBe("entry");
    expect(stageOf("review")).toBe("exit");
  });

  it("снимок без этапа находит своё место по подписи", () => {
    expect(stageOf("", "цель 1")).toBe("manage");
    expect(stageOf("", "цель 2")).toBe("manage");
    expect(stageOf(undefined, "TP2 взят")).toBe("manage");
    expect(stageOf("", "закрытие")).toBe("exit");
    expect(stageOf("", "стоп в безубытке")).toBe("exit");
  });

  it("немой снимок идёт во вход, а не пропадает", () => {
    expect(stageOf("", "")).toBe("entry");
    expect(stageOf(undefined, "плита сверху")).toBe("entry");
  });
});

describe("справка под снимком", () => {
  it("на входе показывает сторону, цену и плечо", () => {
    expect(shotBrief({ id: 1, shot_id: "x", note: "", stage: "entry" }, trade(), t)).toBe(
      "Шорт · 76.687 · ×200",
    );
  });

  it("в ведении перечисляет взятые цели, а не все задуманные", () => {
    const line = shotBrief({ id: 2, shot_id: "x", note: "цель 2", stage: "" }, trade(), t);
    expect(line).toBe("TP1 76.610 · TP2 76.534");
  });

  it("без взятых целей не выдумывает их", () => {
    expect(
      shotBrief(
        { id: 3, shot_id: "x", note: "цель", stage: "manage" },
        trade({ takes_hit: 0 }),
        t,
      ),
    ).toBe("целей пока нет");
  });

  it("на выходе показывает цену закрытия и итог", () => {
    expect(
      shotBrief({ id: 4, shot_id: "x", note: "закрытие", stage: "exit" }, trade(), t),
    ).toBe("76.558 · +207,63");
  });

  it("без сделки молчит: врать подписью нельзя", () => {
    expect(shotBrief({ id: 5, shot_id: "x", note: "", stage: "entry" }, undefined, t)).toBe("");
  });
});
