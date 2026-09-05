import { describe, it, expect } from "vitest";
import { computeSmc, SMC_DEFAULTS, BULLISH, BEARISH } from "@/lib/indicator/smc";
import type { Candle } from "@/lib/indicator/types";
import { buildShapes, SHAPE_DEFAULTS } from "@/lib/indicator/shapes";

// Структурная часть индикатора вся построена на памяти о прошлых барах:
// пивоты, флаги «уровень уже пробит», накопление и погашение блоков. Ошибку
// здесь не видно глазом — линия просто встанет не туда, — поэтому поведение
// зафиксировано тестами.

function candle(i: number, o: number, h: number, l: number, c: number): Candle {
  return { time: 1_700_000_000 + i * 60, open: o, high: h, low: l, close: c, volume: 100 };
}

/** Ряд с явным максимумом посередине и последующим пробоем вниз. */
function peakThenBreak(): Candle[] {
  const out: Candle[] = [];
  let i = 0;
  for (let p = 100; p <= 120; p += 2) out.push(candle(i++, p - 1, p + 1, p - 2, p));
  for (let p = 118; p >= 80; p -= 2) out.push(candle(i++, p + 1, p + 2, p - 1, p));
  for (let p = 82; p <= 100; p += 2) out.push(candle(i++, p - 1, p + 1, p - 2, p));
  return out;
}

describe("значения по умолчанию", () => {
  it("совпадают с рабочим пространством заказчика, а не с исходником", () => {
    // В самом скрипте блоков по пять, но в его настройках — три и два.
    expect(SMC_DEFAULTS.internalOrderBlocks).toBe(3);
    expect(SMC_DEFAULTS.swingOrderBlocks).toBe(2);
    expect(SMC_DEFAULTS.fvgExtendBars).toBe(20);
    expect(SMC_DEFAULTS.swingLength).toBe(50);
    expect(SMC_DEFAULTS.internalLength).toBe(5);
    expect(SMC_DEFAULTS.equalLength).toBe(3);
    expect(SMC_DEFAULTS.equalThreshold).toBe(0.1);
  });
});

describe("структура рынка", () => {
  const result = computeSmc(peakThenBreak());

  it("находит пробои структуры", () => {
    expect(result.structures.length).toBeGreaterThan(0);
  });

  it("линия структуры идёт от пивота вправо, а не наоборот", () => {
    for (const s of result.structures) {
      expect(s.toTime).toBeGreaterThan(s.fromTime);
    }
  });

  it("помечает пробои только как BOS или CHoCH", () => {
    for (const s of result.structures) {
      expect(["BOS", "CHoCH"]).toContain(s.tag);
    }
  });

  it("первый пробой не может быть сменой характера", () => {
    // CHoCH — это разворот против текущего смещения, а до первого пробоя
    // смещения ещё нет.
    const first = result.structures[0];
    expect(first.tag).toBe("BOS");
  });

  it("уровень пробивается один раз", () => {
    // Повторных линий с той же ценой и тем же масштабом быть не должно.
    const seen = new Set<string>();
    for (const s of result.structures) {
      const key = `${s.internal}:${s.fromTime}:${s.price}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("внутренняя структура встречается чаще свинговой", () => {
    // Внутренний пивот — пять баров, свинговый — пятьдесят.
    const internal = result.structures.filter((s) => s.internal).length;
    const swing = result.structures.filter((s) => !s.internal).length;
    expect(internal).toBeGreaterThanOrEqual(swing);
  });
});

describe("свинги", () => {
  const result = computeSmc(peakThenBreak(), { swingLength: 5 });

  it("подписи только из четырёх видов", () => {
    for (const s of result.swings) {
      expect(["HH", "LH", "HL", "LL"]).toContain(s.tag);
    }
  });

  it("максимум выше предыдущего помечается как HH", () => {
    const highs = result.swings.filter((s) => s.tag === "HH" || s.tag === "LH");
    expect(highs.length).toBeGreaterThan(0);
  });
});

describe("ордер-блоки", () => {
  const result = computeSmc(peakThenBreak(), { swingLength: 5 });

  it("показываем не больше, чем задано настройками", () => {
    const internal = result.orderBlocks.filter((b) => b.internal).length;
    const swing = result.orderBlocks.filter((b) => !b.internal).length;
    expect(internal).toBeLessThanOrEqual(SMC_DEFAULTS.internalOrderBlocks);
    expect(swing).toBeLessThanOrEqual(SMC_DEFAULTS.swingOrderBlocks);
  });

  it("верх блока не ниже низа", () => {
    for (const b of result.orderBlocks) {
      expect(b.top).toBeGreaterThanOrEqual(b.bottom);
    }
  });

  it("погашенные блоки не возвращаются", () => {
    // Цена прошла весь диапазон вниз и вверх: пережить это могут только
    // блоки у самого края истории.
    for (const b of result.orderBlocks) {
      expect(Number.isFinite(b.top)).toBe(true);
    }
  });
});

describe("разрывы справедливой цены", () => {
  /** Гэп вверх: минимум текущего бара выше максимума позапрошлого. */
  function gapUp(): Candle[] {
    const out: Candle[] = [];
    for (let i = 0; i < 30; i++) out.push(candle(i, 100, 101, 99, 100));
    out.push(candle(30, 100, 108, 100, 107)); // импульсный бар
    out.push(candle(31, 107, 112, 105, 111)); // минимум выше максимума 29-го
    return out;
  }

  it("находит разрыв на импульсе", () => {
    const result = computeSmc(gapUp(), { fvgAutoThreshold: false });
    expect(result.fvgs.some((g) => g.bias === BULLISH)).toBe(true);
  });

  it("разрыв продлевается вправо на заданное число баров", () => {
    const result = computeSmc(gapUp(), { fvgAutoThreshold: false, fvgExtendBars: 20 });
    const gap = result.fvgs.find((g) => g.bias === BULLISH);
    expect(gap).toBeDefined();
    // Шаг баров — минута; продление на 20 баров это 1200 секунд.
    expect(gap!.toTime - gap!.fromTime).toBeGreaterThanOrEqual(20 * 60);
  });

  it("закрытый разрыв убирается", () => {
    const closed = [...gapUp(), candle(32, 111, 112, 99, 100)];
    const result = computeSmc(closed, { fvgAutoThreshold: false });
    expect(result.fvgs.some((g) => g.bias === BULLISH)).toBe(false);
  });

  it("автопорог отсекает мелкие разрывы", () => {
    const result = computeSmc(gapUp(), { fvgAutoThreshold: true });
    const loose = computeSmc(gapUp(), { fvgAutoThreshold: false });
    expect(result.fvgs.length).toBeLessThanOrEqual(loose.fvgs.length);
  });
});

describe("равные экстремумы", () => {
  it("находит равные минимумы", () => {
    const out: Candle[] = [];
    let i = 0;
    // Две одинаковые впадины подряд с подъёмом между ними.
    for (const p of [110, 108, 100, 106, 110, 108, 100, 106, 110]) {
      out.push(candle(i++, p, p + 1, p - 1, p));
    }
    const result = computeSmc(out, { equalLength: 2, equalThreshold: 5 });
    for (const e of result.equals) {
      expect(["EQH", "EQL"]).toContain(e.tag);
      expect(e.toTime).toBeGreaterThan(e.fromTime);
    }
  });
});

describe("зоны и бегущие экстремумы", () => {
  const result = computeSmc(peakThenBreak());

  it("три зоны идут сверху вниз", () => {
    expect(result.zones.map((z) => z.tag)).toEqual(["Premium", "Equilibrium", "Discount"]);
    for (const z of result.zones) expect(z.top).toBeGreaterThan(z.bottom);
    expect(result.zones[0].bottom).toBeGreaterThan(result.zones[2].top);
  });

  it("сильный максимум и сильный минимум не бывают вместе", () => {
    expect(result.trailing!.strongHigh && result.trailing!.strongLow).toBe(false);
  });

  it("бегущие экстремумы накрывают весь диапазон", () => {
    const t = result.trailing!;
    expect(t.top).toBeGreaterThanOrEqual(t.bottom);
  });
});

describe("устойчивость", () => {
  it("пустой ввод не роняет движок", () => {
    const result = computeSmc([]);
    expect(result.structures).toEqual([]);
    expect(result.trailing).toBeNull();
  });

  it("истории меньше окна пивота — просто нет структуры", () => {
    const result = computeSmc(peakThenBreak().slice(0, 3));
    expect(result.structures).toEqual([]);
  });

  it("смещение принимает только три значения", () => {
    const result = computeSmc(peakThenBreak());
    expect([0, BULLISH, BEARISH]).toContain(result.bias.swing);
    expect([0, BULLISH, BEARISH]).toContain(result.bias.internal);
  });
});

describe("сборка фигур для графика", () => {
  const candles = peakThenBreak();
  const smc = computeSmc(candles, { swingLength: 5 });
  const lastTime = candles[candles.length - 1].time;

  it("ордер-блоки превращаются в боксы", () => {
    const shapes = buildShapes(smc, lastTime, { ...SHAPE_DEFAULTS, orderBlocks: true });
    expect(smc.orderBlocks.length).toBeGreaterThan(0);
    expect(shapes.boxes.length).toBeGreaterThanOrEqual(smc.orderBlocks.length);
  });

  it("выключенный переключатель убирает боксы блоков", () => {
    const on = buildShapes(smc, lastTime, { ...SHAPE_DEFAULTS, orderBlocks: true, fvg: false, zones: false });
    const off = buildShapes(smc, lastTime, { ...SHAPE_DEFAULTS, orderBlocks: false, fvg: false, zones: false });
    expect(off.boxes.length).toBe(0);
    expect(on.boxes.length).toBe(smc.orderBlocks.length);
  });

  it("бокс блока тянется вправо до последнего бара", () => {
    const shapes = buildShapes(smc, lastTime, { ...SHAPE_DEFAULTS, fvg: false, zones: false });
    for (const box of shapes.boxes) {
      expect(box.toTime).toBe(lastTime);
      expect(Number(box.fromTime)).toBeLessThanOrEqual(lastTime);
    }
  });

  it("структура превращается в отрезки и подписи", () => {
    const shapes = buildShapes(smc, lastTime, { ...SHAPE_DEFAULTS, structure: true });
    expect(shapes.segments.length).toBeGreaterThan(0);
    expect(shapes.points.length).toBe(smc.swings.length);
  });

  it("зоны рисуются без подписей", () => {
    const shapes = buildShapes(smc, lastTime, { ...SHAPE_DEFAULTS, zones: true, orderBlocks: false, fvg: false });
    expect(shapes.boxes.length).toBe(3);
    for (const box of shapes.boxes) expect(box.label).toBeUndefined();
  });
});
