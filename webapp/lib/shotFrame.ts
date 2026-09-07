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
 * Откуда взялись пиксели снимка.
 *
 * Источник называем вслух, потому что пустой снимок надо уметь объяснить: с
 * холстов страницы, из собственного снимка библиотеки - или ниоткуда.
 */
export type ShotSource = "layers" | "library" | "empty";

export type ShotResult = {
  canvas: HTMLCanvasElement;
  source: ShotSource;
  /** Размеры найденных холстов - строкой, для честного сообщения трейдеру. */
  layers: string;
};

/**
 * Есть ли на холсте хоть что-то, кроме ровной заливки.
 *
 * Поле заливается одним цветом перед рисованием, поэтому любой второй цвет -
 * уже содержимое. Читаем холст целиком один раз и идём по нему с шагом: точки
 * поштучно на снимке в пятнадцать мегабайт заняли бы заметное время.
 */
function hasInk(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
  let dots: Uint8ClampedArray;
  try {
    dots = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // Холст закрыт для чтения - считаем, что содержимое есть: пусть лучше
    // снимок уйдёт как есть, чем мы объявим его пустым по ошибке.
    return true;
  }

  const step = Math.max(1, Math.floor(canvas.width / 300)) * 4;
  let first = -1;
  for (let i = 0; i < dots.length; i += step) {
    const dot = (dots[i] << 24) | (dots[i + 1] << 16) | (dots[i + 2] << 8) | dots[i + 3];
    if (first === -1) first = dot;
    else if (dot !== first) return true;
  }
  return false;
}

/**
 * Снимок графика: то, что нарисовано на экране.
 *
 * Основной путь - сложить холсты страницы в порядке наложения: только так в
 * картинку попадают наши слои - объёмные свечи, боксы сделки, ленты индикатора.
 *
 * Если со слоёв ничего не пришло, берём собственный снимок библиотеки. Он рисует
 * её ряды заново и не зависит от того, что случилось с холстами на странице, -
 * график без нашей разметки лучше, чем пустой лист.
 *
 * Фон в обоих случаях заливаем сами, до всего остального: у графика в тёмной
 * теме он прозрачный, чёрное поле трейдер видит сквозь холсты, со страницы.
 */
export function snapshot(
  chart: IChartApi,
  box: HTMLElement,
  theme: ShotTheme,
): ShotResult | null {
  const frame = box.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(frame.width * ratio);
  const height = Math.round(frame.height * ratio);
  if (width === 0 || height === 0) return null;

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  const paint = backdrop(box, theme);
  // Заливка сбрасывает систему координат и заново задаёт плотность экрана:
  // дальше всё рисуется в экранных точках, как их видит трейдер.
  const clear = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, width, height);
    ctx.scale(ratio, ratio);
  };

  const layers = Array.from(box.querySelectorAll("canvas")).filter(
    (canvas) => canvas.width > 0 && canvas.height > 0,
  );
  const note = layers.map((c) => `${c.width}x${c.height}`).join(" ") || "нет";

  clear();
  for (const layer of layers) {
    const at = layer.getBoundingClientRect();
    try {
      ctx.drawImage(layer, at.left - frame.left, at.top - frame.top, at.width, at.height);
    } catch {
      // Слой, закрытый для чтения, пропускаем: снимок без одного слоя лучше,
      // чем ошибка вместо картинки.
    }
  }
  if (hasInk(out, ctx)) return { canvas: out, source: "layers", layers: note };

  let own: HTMLCanvasElement | null = null;
  try {
    own = chart.takeScreenshot();
  } catch {
    own = null;
  }
  if (own && own.width > 0) {
    clear();
    try {
      ctx.drawImage(own, 0, 0, frame.width, frame.height);
    } catch {
      // Ничего: ниже отдадим пустой снимок и скажем об этом вслух.
    }
    if (hasInk(out, ctx)) return { canvas: out, source: "library", layers: note };
  }

  return { canvas: out, source: "empty", layers: note };
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
