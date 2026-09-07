"use client";

// Рисование снимка графика: снять холсты с экрана и собрать из них картинку.
//
// Файл нарочно без единого импорта времени выполнения: всё, что здесь есть, -
// холст, кисть и арифметика. Так эту часть можно прогнать в настоящем браузере
// отдельно от терминала и увидеть глазами, что получилось, а не гадать.
//
// Главная ловушка здесь одна, и она стоила нескольких пустых снимков: у графика
// в тёмной теме фон задан прозрачным, чёрное поле трейдер видит сквозь холсты -
// со страницы. Сложишь холсты как есть - получишь прозрачный PNG, который любой
// просмотрщик покажет белым листом. Поэтому фон рисуется здесь сам.

import type { IChartApi } from "lightweight-charts";

/** Высота шапки над графиком, экранные точки. */
const HEAD = 44;

/** Высота подписи под графиком: знак и адрес. */
const FOOT = 34;

/** Толщина рамки вокруг снимка. */
const FRAME = 2;

export type ShotTheme = "dark" | "light";

export type ShotMeta = {
  symbol: string;
  interval: string;
  /** Имя трейдера в подписи. Пусто - подписи не будет. */
  author?: string;
  /** Тема снимка: подпись рисуется в цветах графика, а не наоборот. */
  theme: ShotTheme;
};

export const THEMES: Record<
  ShotTheme,
  { bg: string; head: string; line: string; text: string; muted: string; frame: string }
> = {
  // Рамка контрастна теме: тёмный снимок обводится белым, светлый чёрным. Без
  // неё картинка сливается с фоном переписки, куда её вставляют.
  dark: {
    bg: "#0B0E11",
    head: "#181A20",
    line: "#2B3139",
    text: "#EAECEF",
    muted: "#7A8290",
    frame: "#FFFFFF",
  },
  light: {
    bg: "#FFFFFF",
    head: "#F2F3F5",
    line: "#D6DCDE",
    text: "#111418",
    muted: "#787B86",
    frame: "#000000",
  },
};

/**
 * Цвет, который трейдер видит за графиком.
 *
 * Идём вверх по родителям до первого непрозрачного фона. Брать цвет из темы
 * было бы короче, но тогда снимок разошёлся бы с экраном в тот день, когда
 * поле графика перекрасят, - а расходиться он не должен.
 */
export function backdrop(node: Element | null, theme: ShotTheme): string {
  for (let at: Element | null = node; at; at = at.parentElement) {
    const paint = getComputedStyle(at).backgroundColor;
    if (paint && paint !== "transparent" && !/,\s*0\s*\)$/.test(paint)) return paint;
  }
  return THEMES[theme].bg;
}

/**
 * Снимок графика: то, что нарисовано на экране.
 *
 * Свой снимок у библиотеки есть, но он рисует заново только её слои, а наши -
 * объёмные свечи, боксы сделки, ленты индикатора - остаются за кадром. Поэтому
 * складываем холсты страницы в порядке наложения, как их видит трейдер.
 *
 * Считаем в экранных точках и один раз задаём плотность: пересчитывать каждый
 * слой руками - тот самый путь, на котором картинка уезжала за край.
 */
export function snapshot(
  chart: IChartApi,
  box: HTMLElement,
  theme: ShotTheme,
): HTMLCanvasElement | null {
  const layers = Array.from(box.querySelectorAll("canvas")).filter(
    (canvas) => canvas.width > 0 && canvas.height > 0,
  );
  if (layers.length === 0) {
    try {
      return chart.takeScreenshot();
    } catch {
      return null;
    }
  }

  const frame = box.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;

  const out = document.createElement("canvas");
  out.width = Math.round(frame.width * ratio);
  out.height = Math.round(frame.height * ratio);

  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);

  // Фон - первым и обязательно: холсты графика прозрачные, поле трейдер видит
  // со страницы. Без этой заливки снимок выходит прозрачным насквозь.
  ctx.fillStyle = backdrop(box, theme);
  ctx.fillRect(0, 0, frame.width, frame.height);

  for (const layer of layers) {
    const at = layer.getBoundingClientRect();
    try {
      ctx.drawImage(layer, at.left - frame.left, at.top - frame.top, at.width, at.height);
    } catch {
      // Слой, закрытый для чтения, пропускаем: снимок без одного слоя лучше,
      // чем ошибка вместо картинки.
    }
  }
  return out;
}

/**
 * Знак для подписи.
 *
 * Загружается один раз и остаётся в памяти: снимки делают подряд. Не загрузился
 * - подпись обойдётся без знака, но снимок всё равно получится: картинка важнее
 * украшения.
 */
let logo: HTMLImageElement | null = null;

export function loadLogo(): Promise<HTMLImageElement | null> {
  if (logo?.complete) return Promise.resolve(logo);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      logo = image;
      resolve(image);
    };
    image.onerror = () => resolve(null);
    image.src = "/nmnh_logo.png";
  });
}

/**
 * Собрать снимок: график, шапка с подписями, рамка и наш знак снизу.
 *
 * Возвращает готовый холст - из него получаются и файл, и буфер обмена, и
 * ссылка, поэтому собирается он один раз на все три случая.
 */
export function composeShot(
  chart: HTMLCanvasElement,
  meta: ShotMeta,
  mark?: HTMLImageElement | null,
): HTMLCanvasElement {
  const palette = THEMES[meta.theme];
  const ratio = window.devicePixelRatio || 1;
  const head = Math.round(HEAD * ratio);
  const foot = Math.round(FOOT * ratio);
  const edge = Math.max(1, Math.round(FRAME * ratio));

  const out = document.createElement("canvas");
  out.width = chart.width + edge * 2;
  out.height = chart.height + head + foot + edge * 2;

  const ctx = out.getContext("2d");
  if (!ctx) return chart;

  // Координаты считаем явно, от левого верхнего угла рамки. Сдвиг системы
  // координат читается короче, но легко уводит рисование за холст.
  const left = edge;
  const top = edge;

  ctx.fillStyle = palette.frame;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(left, top, chart.width, chart.height + head + foot);

  // График - первым: он здесь главное, оформление вокруг него.
  ctx.drawImage(chart, left, top + head);

  ctx.fillStyle = palette.head;
  ctx.fillRect(left, top, chart.width, head);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = Math.max(1, ratio);
  ctx.beginPath();
  ctx.moveTo(left, top + head);
  ctx.lineTo(left + chart.width, top + head);
  ctx.stroke();

  const pad = 16 * ratio;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  ctx.fillStyle = palette.text;
  ctx.font = `700 ${17 * ratio}px Inter, system-ui, sans-serif`;
  const symbol = meta.symbol.replace(/USDT$/, "");
  ctx.fillText(symbol, left + pad, top + head / 2);

  const width = ctx.measureText(symbol).width;
  ctx.fillStyle = palette.muted;
  ctx.font = `${13 * ratio}px "JetBrains Mono", monospace`;
  ctx.fillText(meta.interval, left + pad + width + 10 * ratio, top + head / 2);

  // Справа - кто и когда. Чужой график без времени невозможно ни проверить, ни
  // обсудить.
  const stamp = new Date().toLocaleString("ru", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const sign = meta.author ? `@${meta.author} · ${stamp}` : stamp;
  ctx.textAlign = "right";
  ctx.fillText(sign, left + chart.width - pad, top + head / 2);
  ctx.textAlign = "left";

  // Подпись под графиком слева: знак и адрес. По ним снимок узнают, куда бы его
  // ни переслали.
  const baseline = top + head + chart.height + foot / 2;
  let x = left + pad;
  const badge = mark ?? logo;
  if (badge?.complete && badge.naturalWidth > 0) {
    const size = 20 * ratio;
    try {
      ctx.drawImage(badge, x, baseline - size / 2, size, size);
      x += size + 8 * ratio;
    } catch {
      // Знак не нарисовался - подпись обойдётся текстом.
    }
  }
  ctx.fillStyle = palette.text;
  ctx.font = `700 ${13 * ratio}px Inter, system-ui, sans-serif`;
  ctx.fillText("NMNH.TRADE", x, baseline);

  return out;
}

/**
 * Есть ли на снимке хоть что-то, кроме ровного поля.
 *
 * Пустой снимок выглядит как настоящий: файл на месте, размеры верные, а внутри
 * один цвет. Отличить это можно только по точкам, поэтому смотрим их сами - по
 * редкой сетке и только под шапкой, где должен быть график: шапка своими
 * подписями замаскировала бы пустоту.
 */
export function hasChart(picture: HTMLCanvasElement): boolean {
  const ctx = picture.getContext("2d");
  if (!ctx || picture.width === 0 || picture.height === 0) return false;

  const ratio = window.devicePixelRatio || 1;
  const from = Math.round(HEAD * ratio) + Math.max(1, Math.round(FRAME * ratio));
  if (from >= picture.height) return false;

  try {
    const step = Math.max(1, Math.floor(Math.min(picture.width, picture.height) / 40));
    let first: string | null = null;
    for (let y = from; y < picture.height; y += step) {
      for (let x = 0; x < picture.width; x += step) {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        const dot = `${r},${g},${b},${a}`;
        if (first === null) first = dot;
        else if (dot !== first) return true;
      }
    }
  } catch {
    // Холст закрыт для чтения - считаем, что содержимое есть: пусть лучше
    // снимок уйдёт как есть, чем мы объявим его пустым по ошибке.
    return true;
  }
  return false;
}
