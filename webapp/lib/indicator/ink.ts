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
 * Относительная яркость по правилам доступности.
 *
 * Отличается от `light()` тем, что учитывает гамму экрана: глаз видит разницу
 * между двумя тёмными оттенками не так, как между двумя светлыми, и линейная
 * сумма каналов это заметить не умеет. Для выбора между двумя чернилами нужна
 * именно эта величина.
 */
function relative(color: Rgb): number {
  const channel = (value: number) => {
    const part = value / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Во сколько раз один цвет контрастнее другого. Единица - неразличимы. */
export function contrast(one: Rgb, two: Rgb): number {
  const a = relative(one);
  const b = relative(two);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Чернила, которые будет видно на этой подложке.
 *
 * Берём те из двух, что контрастнее с подложкой, а не те, что по одну сторону
 * от середины яркости.
 *
 * Порог посередине выглядел проще и в двух местах врал. Ячейка, попавшая
 * ровно к середине, получала чернила с контрастом чуть выше единицы - цифра
 * на ней различалась с трудом. А на тёмной панели тёмными чернилами служил её
 * же текст, светлый: густая ячейка светлой палитры - белый рост мегатрона,
 * белое падение вельвета - выходила светлой, и цифра на ней пропадала совсем.
 * Обе беды видно только на той палитре и том листе, где так сошлось; теперь
 * их не бывает вовсе - выбор считается числами по всем сочетаниям.
 *
 * Цвет подложки разобрать не удалось - отдаём тёмные: они и есть обычные
 * чернила панели, и хуже от них не станет.
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

  const cell = mix(fore, under, alpha);
  const darkInk = toRgb(dark);
  const brightInk = toRgb(bright);
  if (!darkInk || !brightInk) return dark;

  return contrast(darkInk, cell) >= contrast(brightInk, cell) ? dark : bright;
}

/**
 * Насколько цвет вообще видно на этом фоне.
 *
 * Разница яркостей, от нуля до единицы. Не отношение контрастов из правил
 * доступности: там речь про текст, а здесь про заливку, и нам нужно ровно одно
 * - отличается она от бумаги или слилась с ней.
 */
export function apart(color: Rgb, back: Rgb): number {
  return Math.abs(light(color) - light(back));
}

/** Ниже этого цвет на фоне уже не читается как отдельная фигура. */
const APART_MIN = 0.12;

/**
 * Довести цвет до видимости на своём фоне, не меняя тона.
 *
 * На белом листе у стандартной палитры рост белый, у мегатрона тоже, у вельвета
 * белым выходит падение: чистая заливка такого цвета на белой бумаге
 * пропадает, и сторона объёма исчезает целиком. Заметить это можно только на
 * том листе и той палитре, где так сошлось, поэтому проверку делает не глаз.
 *
 * Уводим цвет в сторону, противоположную бумаге: на белом темним, на тёмном
 * светлим. Тон остаётся тем же - палитра узнаётся, - а фигура появляется.
 */
export function visibleOn(color: string, back: string): string {
  const fore = toRgb(color);
  const under = toRgb(back);
  if (!fore || !under) return color;
  if (apart(fore, under) >= APART_MIN) return color;

  // Куда уводить: от светлой бумаги к чёрному, от тёмной к белому.
  const target: Rgb = light(under) > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  // Шагами по десятой доле: доводим ровно настолько, насколько нужно, а не до
  // упора - иначе бледная палитра почернела бы целиком.
  for (let part = 0.1; part <= 1; part += 0.1) {
    const moved = mix(target, fore, part);
    if (apart(moved, under) >= APART_MIN) return rgbText(moved);
  }
  return rgbText(target);
}

/**
 * Обратно в строку.
 *
 * Шестнадцатеричной записью, а не `rgb()`: этот цвет уходит дальше в `rgba`,
 * которая разбирает только её, - и запись из трёх чисел развалила бы все
 * полупрозрачные оттенки панели разом.
 */
function rgbText(color: Rgb): string {
  const byte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
}
