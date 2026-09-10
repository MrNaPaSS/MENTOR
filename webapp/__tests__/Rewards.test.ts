import { describe, it, expect } from "vitest";
import { rewardLabel } from "@/lib/rewardLabel";
import { summarize } from "@/lib/useCoins";
import { dict } from "@/lib/i18n";

const t = dict("ru");

function tx(over: Partial<{ id: number; amount: number; reason: string; ref: string }> = {}) {
  return {
    id: 1,
    amount: 10,
    reason: "trade_win",
    ref: "trade_t1",
    created_at: "2026-09-10T10:00:00Z",
    pending: true,
    ...over,
  };
}

describe("rewardLabel", () => {
  it("называет достижение его названием из аналитики", () => {
    expect(rewardLabel(tx({ reason: "achievement", ref: "streak_3" }), t)).toBe("Достижение «Трёхдневка»");
  });

  it("незнакомое достижение - просто «Достижение»", () => {
    expect(rewardLabel(tx({ reason: "achievement", ref: "что_то_новое" }), t)).toBe("Достижение");
  });

  it("достаёт номер уровня и длину серии из ссылки", () => {
    expect(rewardLabel(tx({ reason: "level_up", ref: "level_5" }), t)).toBe("Уровень 5");
    // В идентификаторе сделки тоже бывают подчёркивания - длина серии последняя.
    expect(rewardLabel(tx({ reason: "trade_streak", ref: "streak_ab_cd_10" }), t)).toBe("Серия плюсов: 10 подряд");
  });

  it("веха объёма показывает свою метку", () => {
    expect(rewardLabel(tx({ reason: "volume_milestone", ref: "vol_milestone_50K" }), t)).toBe("Веха объёма 50K");
  });

  it("учебные события и незнакомые причины", () => {
    expect(rewardLabel(tx({ reason: "module_completed", ref: "module_3" }), t)).toBe("Модуль пройден");
    expect(rewardLabel(tx({ reason: "что_то_новое" }), t)).toBe("Награда");
  });
});

describe("summarize", () => {
  it("одни долги - забирать нечего", () => {
    expect(summarize([tx({ amount: -5, reason: "trade_loss" })])).toEqual({ total: 0, count: 0 });
  });

  it("итог - награды минус долги, в счётчике только награды", () => {
    const rows = [tx({ id: 1, amount: 10 }), tx({ id: 2, amount: 25 }), tx({ id: 3, amount: -5 })];
    expect(summarize(rows)).toEqual({ total: 30, count: 2 });
  });
});
