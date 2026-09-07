import { describe, expect, it } from "vitest";

import {
  draftAt,
  flip,
  maxMargin,
  moveLevel,
  qtyOf,
  riskOf,
  rewardOf,
  rrOf,
  sideOf,
} from "@/lib/trade/manual";

const base = {
  side: "long" as const,
  entry: 80_000,
  stop: 79_900,
  take: 80_200,
  margin: 100,
  leverage: 10,
};

describe("заготовка лимитки", () => {
  it("ниже рынка покупает, выше рынка продаёт", () => {
    expect(draftAt(79_000, 80_000, 100, 100, 10).side).toBe("long");
    expect(draftAt(81_000, 80_000, 100, 100, 10).side).toBe("short");
  });

  it("ставит стоп и цель по разные стороны входа", () => {
    const long = draftAt(79_000, 80_000, 100, 100, 10);
    expect(long.stop).toBeLessThan(long.entry);
    expect(long.take).toBeGreaterThan(long.entry);

    const short = draftAt(81_000, 80_000, 100, 100, 10);
    expect(short.stop).toBeGreaterThan(short.entry);
    expect(short.take).toBeLessThan(short.entry);
  });

  it("цель вдвое дальше стопа: сделка, где риск больше взятого, начинаться не должна", () => {
    const draft = draftAt(79_000, 80_000, 100, 100, 10);
    expect(rrOf(draft)).toBeCloseTo(2, 6);
  });

  it("без ATR отходит от цены на свою долю, а не встаёт вплотную", () => {
    const draft = draftAt(1000, 1100, 0, 100, 10);
    expect(draft.stop).toBeLessThan(draft.entry);
    expect(draft.entry - draft.stop).toBeCloseTo(1.5, 6);
  });
});

describe("деньги", () => {
  it("объём - это маржа с плечом, поделённая на вход", () => {
    expect(qtyOf(base)).toBeCloseTo(0.0125, 9);
  });

  it("риск и прибыль считаются от объёма и расстояния", () => {
    expect(riskOf(base)).toBeCloseTo(1.25, 9);
    expect(rewardOf(base)).toBeCloseTo(2.5, 9);
    expect(rrOf(base)).toBeCloseTo(2, 9);
  });

  it("бессмысленный ввод не считается, а не даёт NaN", () => {
    expect(qtyOf({ ...base, entry: 0 })).toBe(0);
    expect(qtyOf({ ...base, margin: 0 })).toBe(0);
    expect(rrOf({ ...base, stop: base.entry })).toBe(0);
  });
});

describe("перетаскивание уровней", () => {
  it("стоп лонга не переходит вход: биржа такую заявку не примет", () => {
    const moved = moveLevel(base, "stop", 80_500, 0.1);
    expect(moved.stop).toBeCloseTo(79_999.9, 6);
  });

  it("цель лонга не переходит вход", () => {
    const moved = moveLevel(base, "take", 79_000, 0.1);
    expect(moved.take).toBeCloseTo(80_000.1, 6);
  });

  it("у шорта пределы зеркальны", () => {
    const short = { ...base, side: "short" as const, stop: 80_100, take: 79_800 };
    expect(moveLevel(short, "stop", 79_000, 0.1).stop).toBeCloseTo(80_000.1, 6);
    expect(moveLevel(short, "take", 81_000, 0.1).take).toBeCloseTo(79_999.9, 6);
  });

  it("вход тянет стоп и цель за собой: расстояния трейдер задал сам", () => {
    const moved = moveLevel(base, "entry", 80_500, 0.1);
    expect(moved.entry).toBe(80_500);
    expect(moved.stop).toBe(80_400);
    expect(moved.take).toBe(80_700);
  });

  it("уровень внутри допустимого встаёт ровно туда, куда дотянули", () => {
    expect(moveLevel(base, "stop", 79_500, 0.1).stop).toBe(79_500);
    expect(moveLevel(base, "take", 81_000, 0.1).take).toBe(81_000);
  });

  it("бессмысленная цена ничего не меняет", () => {
    expect(moveLevel(base, "stop", 0, 0.1)).toEqual(base);
  });
});

describe("сторона", () => {
  it("определяется тем, куда смотрит цель", () => {
    expect(sideOf(80_000, 80_500)).toBe("long");
    expect(sideOf(80_000, 79_500)).toBe("short");
  });

  it("разворот меняет сторону, сохраняя расстояния", () => {
    const turned = flip(base);
    expect(turned.side).toBe("short");
    expect(turned.stop).toBe(80_100);
    expect(turned.take).toBe(79_800);
    expect(riskOf(turned)).toBeCloseTo(riskOf(base), 9);
    expect(rewardOf(turned)).toBeCloseTo(rewardOf(base), 9);
  });
});


describe("предельная сумма", () => {
  it("не больше свободных денег счёта", () => {
    expect(maxMargin(80_000, 10, 250)).toBe(250);
  });

  it("считает потолок заявки по монете через цену и плечо", () => {
    // 0.5 монеты по 80 000 - это 40 000 позиции, на десятом плече 4 000 маржи.
    expect(maxMargin(80_000, 10, 1e9, { maxQty: 0.5 })).toBeCloseTo(4_000, 6);
  });

  it("берёт самое строгое из ограничений", () => {
    expect(maxMargin(80_000, 10, 1_000, { maxQty: 0.5, maxPosition: 0.1 })).toBe(800);
  });

  it("без единого известного предела не ограничивает", () => {
    expect(maxMargin(80_000, 10, 0)).toBe(0);
  });

  it("бессмысленный ввод не считает", () => {
    expect(maxMargin(0, 10, 500)).toBe(0);
    expect(maxMargin(80_000, 0, 500)).toBe(0);
  });
});
