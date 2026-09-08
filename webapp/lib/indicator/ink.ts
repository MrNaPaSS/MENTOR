// Каким цветом писать по цветной подложке.
//
// Ячейки объёма красятся цветом выбранных свечей, а он бывает любым: на белом
// листе рост белый, падение чёрное, у пресетов - от бирюзы до фиолетового.
// Одни чернила на все случаи не годятся: чёрная цифра на чёрной ячейке
// пропадает совсем, и заметить это на глаз можно только на той монете и том
// пресете, где так сошлось.
//
// Поэтому цвет чернил считается: подложка полупрозрачная, значит смешиваем её
// с фоном, берём яркость и выбираем к ней светлые чернила или тёмные.

/** Цвет в трёх составляющих. */
export type Rgb = { r: number; g: number; b: number };

/**
 * Разобрать цвет.
 *
 * Больше форматов, чем `#rrggbb`, нам не встречается: цвета приходят либо из
 * переменных оформления, либо из палитры свечей, и там либо шестнадцатеричная
 * запись, либо `rgb`/`rgba`. Всё прочее - повод отступить, а не гадать.
 */
export function toRgb(color: string): Rgb | null {
  const value = color.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const body = hex[1];
    const full =
      body.length === 3
        ? body
            .split("")
            .map((c) => c + c)
            .join("")
        : body;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }

  return null;
}

/** Смешать краску с фоном: полупрозрачная ячейка на экране выглядит именно так. */
export function mix(fore: Rgb, back: Rgb, alpha: number): Rgb {
  const part = Math.min(1, Math.max(0, alpha));
  return {
    r: back.r + (fore.r - back.r) * part,
    g: back.g + (fore.g - back.g) * part,
    b: back.b + (fore.b - back.b) * part,
  };
}

/**
 * Насколько цвет светлый, от нуля до единицы.
 *
 * Взвешенная сумма, а не среднее: глаз видит зелёное вдвое ярче красного и
 * впятеро ярче синего, и среднее объявило бы синий светлее, чем он есть.
 */
export function light(color: Rgb): number {
  return (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255;
}

/**
 * Чернила, которые будет видно на этой подложке.
 *
 * Порог посередине: подложка светлее - пишем тёмным, темнее - светлым. Цвет
 * подложки разобрать не удалось - отдаём тёмные: они и есть обычные чернила
 * панели, и хуже от них не станет.
 */
export function readableInk(
  fill: string,
  back: string,
  alpha: number,
  dark: string,
  bright: string,
): string {
  const fore = toRgb(fill);
  const under = toRgb(back);
  if (!fore || !under) return dark;
  return light(mix(fore, under, alpha)) > 0.5 ? dark : bright;
}
