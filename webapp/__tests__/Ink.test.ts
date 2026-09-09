import { describe, it, expect } from "vitest";
import {
  apart,
  contrast,
  fadeLimit,
  light,
  mix,
  readableInk,
  toRgb,
  visibleOn,
} from "@/lib/indicator/ink";
import { CHART_PALETTES, CHART_PAPERS, paletteSwatch } from "@/lib/indicator/presets";
import { HEAT_FLOOR, HEAT_TOP, cellHeat } from "@/lib/indicator/footprintLayout";

// Цифра, пропавшая на своей же подложке, - ошибка, которую видно только на той
// монете и том пресете, где так сошлось. Поэтому выбор чернил считается, а не
// подбирается на глаз, и проверяется числами.

describe("разбор цвета", () => {
  it("шестнадцатеричная запись, длинная и короткая", () => {
    expect(toRgb("#ff0080")).toEqual({ r: 255, g: 0, b: 128 });
    expect(toRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(toRgb("  #0ECB81  ")).toEqual({ r: 14, g: 203, b: 129 });
  });

  it("rgb и rgba", () => {
    expect(toRgb("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(toRgb("rgba(10,20,30,0.4)")).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("незнакомая запись - это не цвет, а повод отступить", () => {
    expect(toRgb("var(--pane-up)")).toBeNull();
    expect(toRgb("")).toBeNull();
    expect(toRgb("тёмно-синий")).toBeNull();
  });
});

describe("смешивание с фоном", () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };

  it("непрозрачная краска фон не пускает", () => {
    expect(mix(black, white, 1)).toEqual(black);
  });

  it("прозрачная краска не видна вовсе", () => {
    expect(mix(black, white, 0)).toEqual(white);
  });

  it("половина даёт середину", () => {
    expect(mix(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });

  it("доля за пределами отрезка не выносит цвет за него", () => {
    // Густота считается от объёма, и разойтись с опорой она может.
    expect(mix(black, white, 5)).toEqual(black);
    expect(mix(black, white, -5)).toEqual(white);
  });
});

describe("яркость", () => {
  it("белое ярче чёрного", () => {
    expect(light({ r: 255, g: 255, b: 255 })).toBe(1);
    expect(light({ r: 0, g: 0, b: 0 })).toBe(0);
  });

  it("зелёное ярче синего той же силы", () => {
    // Среднее объявило бы их одинаковыми, и синяя ячейка получила бы тёмные
    // чернила, на которых её не прочесть.
    expect(light({ r: 0, g: 255, b: 0 })).toBeGreaterThan(light({ r: 0, g: 0, b: 255 }));
  });
});

describe("чернила под подложку", () => {
  const DARK = "#111418";
  const BRIGHT = "#f5f7fa";

  it("на светлой ячейке пишем тёмным", () => {
    expect(readableInk("#ffffff", "#ffffff", 0.8, DARK, BRIGHT)).toBe(DARK);
  });

  it("на тёмной - светлым", () => {
    // Белый лист, падение чёрное: тёмная цифра на нём пропала бы совсем.
    expect(readableInk("#000000", "#ffffff", 0.85, DARK, BRIGHT)).toBe(BRIGHT);
  });

  it("бледная ячейка остаётся светлой подложкой", () => {
    // Двенадцать процентов чёрного на белом - это почти белое.
    expect(readableInk("#000000", "#ffffff", 0.12, DARK, BRIGHT)).toBe(DARK);
  });

  it("на тёмном листе бледная ячейка требует светлых чернил", () => {
    expect(readableInk("#f6465d", "#181a20", 0.2, DARK, BRIGHT)).toBe(BRIGHT);
  });

  it("цвет, который не разобрать, чернил не меняет", () => {
    expect(readableInk("var(--pane-up)", "#181a20", 0.8, DARK, BRIGHT)).toBe(DARK);
  });
});

describe("суммы в ячейках читаются во всех палитрах", () => {
  // Проверка не на глаз, а перебором: палитр шесть, листа два, густота ячейки
  // зависит от объёма, и пропасть цифра может ровно в одном сочетании из
  // двух десятков - на той монете, того трейдера, в тот день.
  //
  // Цвет цифр один на всю картинку и берётся от листа: выбор под каждую
  // ячейку честен по контрасту, но читается как поломка - в столбце половина
  // сумм белая, половина чёрная. Подстраивается заливка: ярче своего предела
  // ячейка не красится.
  const INK_DARK = "#0b0e11";
  const BRIGHT = "#f5f7fa";
  const NEED = 4;

  for (const palette of CHART_PALETTES) {
    for (const paper of CHART_PAPERS) {
      it(`${palette} на ${paper === "light" ? "белом" : "тёмном"} листе`, () => {
        const back = paper === "light" ? "#ffffff" : "#181a20";
        const letters = paper === "light" ? INK_DARK : BRIGHT;
        const swatch = paletteSwatch(palette, paper);

        for (const raw of [swatch.bull, swatch.bear]) {
          // Панели красятся цветом, доведённым до видимости на своей бумаге -
          // ровно так же, как это делает paneInk().
          const fill = visibleOn(raw, back);
          const cap = fadeLimit(fill, back, letters, NEED, HEAT_TOP, HEAT_FLOOR);
          // Предел не съедает заливку целиком: ячейка обязана остаться ячейкой.
          expect(cap).toBeGreaterThanOrEqual(HEAT_FLOOR);

          for (const share of [0.01, 0.2, 0.5, 0.8, 1]) {
            const cell = mix(toRgb(fill)!, toRgb(back)!, cellHeat(share, 1, cap));
            expect(contrast(toRgb(letters)!, cell)).toBeGreaterThanOrEqual(NEED);
          }
        }
      });
    }
  }
});

describe("предел густоты", () => {
  it("светлая заливка на тёмном листе гасится сильнее", () => {
    // Белое падение вельвета на тёмной панели: густая ячейка становится
    // светлой, и белая цифра на ней пропадает. Предел здесь ниже, чем у
    // зелёного, - и это ровно то, ради чего он считается по цвету.
    const white = fadeLimit("#ffffff", "#181a20", "#f5f7fa", 4, HEAT_TOP, HEAT_FLOOR);
    const green = fadeLimit("#0ecb81", "#181a20", "#f5f7fa", 4, HEAT_TOP, HEAT_FLOOR);
    expect(white).toBeLessThan(green);
  });

  it("бледная заливка на белом листе предела не требует", () => {
    // Серое падение бумажной палитры: даже в полную силу оно остаётся светлее
    // чёрной цифры на нём.
    expect(fadeLimit("#8a90a6", "#ffffff", "#0b0e11", 4, HEAT_TOP, HEAT_FLOOR)).toBe(HEAT_TOP);
  });

  it("заливка цвета самих цифр гасится до предела", () => {
    // Крайний случай: ячейка того же цвета, что и цифра на ней. Читать там
    // нечего ни при какой густоте, кроме самой бледной.
    expect(fadeLimit("#0b0e11", "#ffffff", "#0b0e11", 4, HEAT_TOP, HEAT_FLOOR)).toBeLessThan(
      HEAT_TOP,
    );
  });

  it("цвет, который не разобрать, предела не меняет", () => {
    expect(fadeLimit("var(--pane-up)", "#181a20", "#f5f7fa", 4, HEAT_TOP, HEAT_FLOOR)).toBe(
      HEAT_TOP,
    );
  });
});

describe("цвет доводится до видимости на своей бумаге", () => {
  const WHITE = "#ffffff";
  const DARK = "#181a20";

  it("белый рост на белом листе темнеет", () => {
    // Стандартная палитра и мегатрон: рост на белом задан белым, и заливка
    // такого цвета на бумаге пропадает целиком.
    const fixed = visibleOn("#ffffff", WHITE);
    expect(fixed).not.toBe("#ffffff");
    expect(apart(toRgb(fixed)!, toRgb(WHITE)!)).toBeGreaterThanOrEqual(0.12);
  });

  it("почти белое на белом - тоже", () => {
    // Вельвет: падение на белом листе остаётся белым телом в тёплой рамке.
    const fixed = visibleOn("#fdfdfc", WHITE);
    expect(apart(toRgb(fixed)!, toRgb(WHITE)!)).toBeGreaterThanOrEqual(0.12);
  });

  it("тёмный цвет на тёмном листе светлеет", () => {
    const fixed = visibleOn("#1a1c22", DARK);
    expect(apart(toRgb(fixed)!, toRgb(DARK)!)).toBeGreaterThanOrEqual(0.12);
  });

  it("видимый цвет не трогаем вовсе", () => {
    // Палитра обязана оставаться собой везде, где она и так читается.
    expect(visibleOn("#0ecb81", DARK)).toBe("#0ecb81");
    expect(visibleOn("#f23645", WHITE)).toBe("#f23645");
    expect(visibleOn("#4a4a4a", WHITE)).toBe("#4a4a4a");
  });

  it("тон сохраняется: розовое остаётся розовым", () => {
    // Уводим к чёрному или белому долями, а не заменяем цвет: иначе на белом
    // листе все палитры стали бы одинаково чёрными.
    const fixed = toRgb(visibleOn("#fff0f0", WHITE))!;
    expect(fixed.r).toBeGreaterThan(fixed.b);
  });

  it("цвет, который не разобрать, отдаём как есть", () => {
    expect(visibleOn("var(--pane-up)", WHITE)).toBe("var(--pane-up)");
  });

  it("возвращается шестнадцатеричная запись", () => {
    // Дальше цвет уходит в rgba(), а она разбирает только её.
    expect(visibleOn("#ffffff", WHITE)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
