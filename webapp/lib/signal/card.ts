"use client";

// Карточка сигнала: тот бланк, которым делятся в форуме.
//
// Отдельно от карточки результата (`lib/pnl/card.ts`) намеренно. Та про итог -
// сколько принесла закрытая сделка; эта про намерение - куда встали, где стоп,
// куда идём. Общего у них только холст, и сводить их в один рисовальщик
// значило бы держать в нём два непохожих бланка и ветвление на каждой строке.
//
// Бланки нарисованы заранее и приходят картинкой: рамки, подписи ENTRY / STOP /
// TARGET, значок стороны и место под печать уже на них. Холст дописывает только
// то, что меняется от сделки к сделке, - пару, плечо, три цены и время, - и
// ставит печать в отведённую рамку.
//
// Доли сняты с самих макетов (1774x887): поля значений найдены по светлым
// прямоугольникам внутри рамок, место печати - по тёмной рамке справа внизу.
// Перерисуют бланк - править надо здесь, и только здесь.

import { dict } from "@/lib/i18n";

export type SignalSide = "long" | "short";

/** Прямоугольник в долях ширины и высоты бланка. */
export type Frame = { x: number; y: number; w: number; h: number };

export type SignalTemplate = {
  id: string;
  side: SignalSide;
  src: string;
  /** Куда встают пара и плечо - слева от значка стороны. */
  pair: Frame;
  leverage: Frame;
  /** Три поля под подписями ENTRY / STOP / TARGET. */
  entry: Frame;
  stop: Frame;
  target: Frame;
  /** Время под полями, над строкой-девизом. */
  time: Frame;
  /** Рамка «PLACE STAMP HERE» справа внизу. */
  stamp: Frame;
  /** Чернила бланка и цвет стороны. */
  ink: string;
  accent: string;
};

const W = 1774;
const H = 887;

/** Доли из пикселей макета - чтобы числа в коде читались как на картинке. */
function frame(x: number, y: number, w: number, h: number): Frame {
  return { x: x / W, y: y / H, w: w / W, h: h / H };
}

// Поля значений: 97..479, 558..931, 1009..1370 по горизонтали и 556..628 по
// вертикали. Время - полоса между полями и девизом.
//
// Пара стоит слева от значка стороны и на одной строке с ним: выше она висела
// сама по себе, оторванная и от значка, и от цен под ним. Плечо ушло вправо от
// значка - оно читается как продолжение направления («лонг, сотым плечом»), а
// не как подпись под парой; там же под ним пусто, и число не спорит ни с чем.
const COMMON = {
  pair: frame(88, 375, 390, 86),
  leverage: frame(1100, 340, 280, 72),
  entry: frame(97, 556, 382, 72),
  stop: frame(558, 556, 373, 72),
  target: frame(1009, 556, 361, 72),
  time: frame(97, 660, 500, 46),
  stamp: frame(1465, 612, 240, 170),
};

export const SIGNAL_TEMPLATES: readonly SignalTemplate[] = [
  {
    id: "signal-long",
    side: "long",
    src: "/cards/signal-long.jpg",
    ...COMMON,
    ink: "#14181C",
    // Глубже мяты самого бланка: светлая мята на белом не читается, а числа
    // здесь - главное, что с карточки забирают глазами.
    accent: "#0F9E66",
  },
  {
    id: "signal-short",
    side: "short",
    src: "/cards/signal-short.jpg",
    ...COMMON,
    ink: "#14181C",
    accent: "#D42638",
  },
];

export function templateFor(side: SignalSide): SignalTemplate {
  return SIGNAL_TEMPLATES.find((t) => t.side === side) ?? SIGNAL_TEMPLATES[0];
}

/** Что печатается на бланке. */
export type SignalData = {
  /** Пара как её знает биржа: BTCUSDT. Показываем как BTC / USDT. */
  symbol: string;
  side: SignalSide;
  leverage: number;
  entry: number;
  stop: number;
  /** Первая цель. Их бывает несколько, но на бланке одна рамка. */
  target: number | null;
  /** Когда выставлено, ISO. */
  at: string;
};

const STAMP_SRC = "/cards/signal-stamp.png";

// Тот же множитель, что у карточки результата: бланк отдают в мессенджеры, и
// на телефоне с плотным экраном единица выглядит мыльной.
export const SCALE = 2;

function face(px: number, weight = 700): string {
  return `${weight} ${Math.round(px)}px "Inter", system-ui, -apple-system, sans-serif`;
}

/** Цена с пробелами по тысячам - так же, как в терминале. */
export function price(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 3 : 6;
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Пара двумя частями: BTC / USDT. Хвост биржи режем, а не показываем целиком. */
export function pairOf(symbol: string): string {
  const clean = (symbol || "").toUpperCase();
  for (const quote of ["USDT", "USDC", "USD"]) {
    if (clean.endsWith(quote) && clean.length > quote.length) {
      return `${clean.slice(0, -quote.length)} / ${quote}`;
    }
  }
  return clean || "—";
}

/** Время и часовой пояс: без пояса дата на карточке ничего не заверяет. */
export function stamped(iso: string): string {
  const at = new Date(iso);
  const shown = at.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const offset = -at.getTimezoneOffset() / 60;
  const sign = offset >= 0 ? "+" : "−";
  return `${shown} UTC${sign}${Math.abs(offset)}`;
}

/**
 * Строка, вписанная в рамку.
 *
 * Кегль подбирается по ширине: цены бывают и «3.14», и «104 275.00», и один
 * заданный размер означал бы, что длинная цена вылезет за рамку. Уменьшаем,
 * пока не влезет, - но не мельче половины, иначе число перестаёт читаться.
 */
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: Frame,
  w: number,
  h: number,
  options: { weight?: number; align?: "left" | "center"; size?: number } = {},
): void {
  const { weight = 800, align = "center", size = 0.62 } = options;
  const room = { x: box.x * w, y: box.y * h, w: box.w * w, h: box.h * h };

  let px = room.h * size;
  const limit = room.w * 0.92;
  for (let step = 0; step < 24; step += 1) {
    ctx.font = face(px, weight);
    if (ctx.measureText(text).width <= limit) break;
    px *= 0.94;
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  const x = align === "center" ? room.x + room.w / 2 : room.x;
  ctx.fillText(text, x, room.y + room.h / 2);
}

/** Печать в её рамке. Не сыграла загрузка - бланк остаётся без оттиска. */
async function putStamp(
  ctx: CanvasRenderingContext2D,
  template: SignalTemplate,
  w: number,
  h: number,
): Promise<void> {
  const mark = await load(STAMP_SRC).catch(() => null);
  if (mark === null) return;

  const room = {
    x: template.stamp.x * w,
    y: template.stamp.y * h,
    w: template.stamp.w * w,
    h: template.stamp.h * h,
  };
  // Вписываем целиком, сохраняя пропорции: растянутая печать читается как
  // наклейка, а не как оттиск.
  const scale = Math.min(room.w / mark.naturalWidth, room.h / mark.naturalHeight) * 0.82;
  const iw = mark.naturalWidth * scale;
  const ih = mark.naturalHeight * scale;

  // Оттиск нарисован чёрным, а рамка под ним тёмная - чёрное по тёмному не
  // видно вовсе. Перекрашиваем: рисуем печать на отдельном холсте и заливаем
  // её же по маске. Так меняется цвет, а штрихи и их рваные края остаются.
  const tinted = document.createElement("canvas");
  tinted.width = Math.max(1, Math.round(iw));
  tinted.height = Math.max(1, Math.round(ih));
  const paint = tinted.getContext("2d");
  if (paint === null) return;
  paint.drawImage(mark, 0, 0, tinted.width, tinted.height);
  paint.globalCompositeOperation = "source-in";
  paint.fillStyle = "#F4F7FA";
  paint.fillRect(0, 0, tinted.width, tinted.height);

  ctx.save();
  ctx.translate(room.x + room.w / 2, room.y + room.h / 2);
  // Печать садится не по линейке: ровно вписанная в рамку, она выглядит
  // напечатанной вместе с бланком, а не поставленной поверх.
  ctx.rotate((-6 * Math.PI) / 180);
  ctx.globalAlpha = 0.95;
  // Свечение цветом стороны - тем же, каким горит рамка на бланке.
  ctx.shadowColor = template.accent;
  ctx.shadowBlur = ih * 0.22;
  ctx.drawImage(tinted, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

export function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(dict().pnlCard.templateFailed));
    image.src = src;
  });
}

/** Готовый бланк холстом. */
export async function renderSignal(
  data: SignalData,
  template: SignalTemplate = templateFor(data.side),
  stamp = true,
): Promise<HTMLCanvasElement> {
  const backdrop = await load(template.src);
  const canvas = document.createElement("canvas");
  canvas.width = backdrop.naturalWidth * SCALE;
  canvas.height = backdrop.naturalHeight * SCALE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(dict().pnlCard.canvasUnavailable);

  const w = canvas.width;
  const h = canvas.height;
  ctx.drawImage(backdrop, 0, 0, w, h);

  ctx.fillStyle = template.ink;
  fit(ctx, pairOf(data.symbol), template.pair, w, h, { align: "left", size: 0.78 });

  ctx.fillStyle = template.accent;
  fit(ctx, `×${Math.max(1, Math.round(data.leverage))}`, template.leverage, w, h, {
    align: "left",
    weight: 700,
    size: 0.86,
  });

  // Цены: вход чернилами бланка, стоп и цель - своими цветами. Так три числа
  // различаются и без подписей над ними.
  ctx.fillStyle = template.ink;
  fit(ctx, price(data.entry), template.entry, w, h);
  ctx.fillStyle = "#D42638";
  fit(ctx, price(data.stop), template.stop, w, h);
  ctx.fillStyle = "#0F9E66";
  fit(ctx, price(data.target), template.target, w, h);

  ctx.fillStyle = "rgba(20, 24, 28, 0.55)";
  fit(ctx, stamped(data.at), template.time, w, h, { align: "left", weight: 600, size: 0.62 });

  if (stamp) await putStamp(ctx, template, w, h);
  return canvas;
}
