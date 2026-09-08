"use client";

// Карточка сделки: рисование на холсте.
//
// Такие карточки трейдеры отправляют друг другу вместо слов - на них видно и
// монету, и сторону, и во сколько раз вырос залог. У бирж они есть у всех, и
// человек, пришедший от биржи, ищет её и здесь.
//
// Фон - готовая картинка: бык у лонга, медведь у шорта. Всё остальное рисуется
// поверх, поэтому файл не знает ни про React, ни про сеть: холст, кисть и
// арифметика. Так карточку можно собрать где угодно - в окне журнала, при
// копировании в буфер, при выкладывании ссылкой - одним и тем же кодом, и
// картинка везде выйдет одна и та же.
//
// Все размеры - доли ширины и высоты, а не пиксели. Заготовку однажды
// перерисуют в большем разрешении, и раскладка обязана переехать сама.

export type CardSide = "long" | "short";

export type CardData = {
  symbol: string;
  side: CardSide;
  leverage: number;
  /** Доход в процентах от залога. */
  roi: number;
  /** Доход в USDT - тот, что пришёл на счёт, уже за вычетом комиссии. */
  pnl: number;
  entry: number;
  /** Цена выхода. `null` - сделка ещё идёт, тогда это цена рынка. */
  exit: number | null;
  /** Когда сделка закрылась, ISO. */
  at: string;
  /** Имя владельца. Пусто - подписи не будет. */
  owner?: string;
};

/** Где лежат заготовки. Имя по стороне: другого фона у карточки не бывает. */
export const BACKDROP: Record<CardSide, string> = {
  long: "/pln/card-long.jpg",
  short: "/pln/card-short.jpg",
};

/** Цвет стороны. Тот же, что светится на самой заготовке. */
export const ACCENT: Record<CardSide, string> = {
  long: "#22E07A",
  short: "#FF3B4E",
};

const INK = "#F2F4F7";
const MUTED = "#8A93A0";
const FAINT = "#7C8794";

/**
 * Место под печать - та самая рамка в левом верхнем углу заготовки.
 *
 * Числа сняты с картинки: рамка занимает 20..391 по горизонтали и 23..112 по
 * вертикали при размере 640x852. Наружу отдаём долями - по ним и рисование, и
 * анимация на странице ставят печать в одно и то же место.
 */
export const STAMP_BOX = {
  x: 20 / 640,
  y: 23 / 852,
  w: 371 / 640,
  h: 89 / 852,
};

/** Шрифт карточки. Один на всё: цифры и буквы должны быть одной семьи. */
function face(px: number, weight = 700): string {
  return `${weight} ${px}px "Inter", "Segoe UI", system-ui, sans-serif`;
}

/**
 * Число по-русски: запятая вместо точки, тысячи не разрываются.
 *
 * Пробел между тысячами здесь вреден: карточку читают с телефона в чате, и
 * «+12 021,3087» на маленькой ширине переносится посреди числа.
 */
function ru(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

/**
 * Цена с разумной точностью.
 *
 * Шага инструмента у журнала нет, а показывать 0,16 там, где на бирже 0,16350,
 * нельзя: трейдер сверяет карточку с приложением. Поэтому точность по величине
 * самой цены - так же, как её показывают биржи.
 */
export function price(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1000) return ru(value, 2);
  if (value >= 1) return ru(value, 4);
  if (value >= 0.01) return ru(value, 5);
  return ru(value, 8);
}

/** Знак впереди: у результата он важнее самой цифры. */
function signed(value: number, digits: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return sign + ru(Math.abs(value), digits);
}

/** Время карточки - по часам того, кто её собирает. */
function stamped(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  );
}

/**
 * Затемнение слева.
 *
 * Числа стоят в левой колонке, а зверь на заготовке заходит лапой на неё:
 * «0,16350» ложилось прямо на когти и не читалось. Тень идёт от края к
 * середине и не трогает ни рамку печати сверху, ни панель снизу - там своя
 * графика, и гасить её незачем.
 */
function scrim(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const top = h * 0.145;
  const bottom = h * 0.775;
  const gradient = ctx.createLinearGradient(0, 0, w * 0.62, 0);
  gradient.addColorStop(0, "rgba(4, 7, 10, 0.86)");
  gradient.addColorStop(0.55, "rgba(4, 7, 10, 0.46)");
  gradient.addColorStop(1, "rgba(4, 7, 10, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, w * 0.62, bottom - top);
}

/** Печать NMNH: та, что падает в рамку. */
export function drawStamp(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  side: CardSide,
): void {
  const box = {
    x: STAMP_BOX.x * w,
    y: STAMP_BOX.y * h,
    w: STAMP_BOX.w * w,
    h: STAMP_BOX.h * h,
  };
  const accent = ACCENT[side];

  ctx.save();
  // Печать садится не по линейке: ровно вписанная в рамку, она выглядит
  // напечатанной вместе с бланком, а не поставленной поверх.
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.rotate((-4.5 * Math.PI) / 180);
  ctx.globalAlpha = 0.9;

  const iw = box.w * 0.92;
  const ih = box.h * 0.86;
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(2, w * 0.005);
  ctx.strokeRect(-iw / 2, -ih / 2, iw, ih);
  ctx.lineWidth = Math.max(1, w * 0.0018);
  ctx.strokeRect(-iw / 2 + ih * 0.12, -ih / 2 + ih * 0.12, iw - ih * 0.24, ih - ih * 0.24);

  ctx.fillStyle = accent;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = face(ih * 0.46, 800);
  ctx.fillText("NMNH", -iw / 2 + ih * 0.34, -ih * 0.08);

  ctx.font = face(ih * 0.17, 600);
  ctx.globalAlpha = 0.75;
  ctx.fillText("ПОДТВЕРЖДЕНО ТЕРМИНАЛОМ", -iw / 2 + ih * 0.34, ih * 0.26);

  ctx.textAlign = "right";
  ctx.font = face(ih * 0.2, 700);
  ctx.globalAlpha = 0.85;
  ctx.fillText("TRADE · DISCIPLINE · PROFIT", iw / 2 - ih * 0.3, 0);
  ctx.restore();
}

/**
 * Собрать карточку на готовом холсте.
 *
 * Фон уже загружен вызывающим: загрузка картинки - это сеть, а здесь только
 * рисование, и держать их врозь дешевле - холст можно собрать хоть трижды
 * подряд, не тревожа сеть.
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  backdrop: CanvasImageSource,
  w: number,
  h: number,
  data: CardData,
  stamp: boolean,
): void {
  const accent = ACCENT[data.side];
  ctx.drawImage(backdrop, 0, 0, w, h);
  scrim(ctx, w, h);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const x = w * 0.075;

  ctx.fillStyle = INK;
  ctx.font = face(w * 0.062, 800);
  ctx.fillText(data.symbol, x, h * 0.248);

  ctx.fillStyle = accent;
  ctx.font = face(w * 0.036, 600);
  const side = data.side === "long" ? "Лонг" : "Шорт";
  ctx.fillText(`${side}   |   ${data.leverage}x`, x, h * 0.298);

  ctx.font = face(w * 0.098, 800);
  ctx.fillText(`${signed(data.roi, 2)}%`, x, h * 0.42);

  ctx.font = face(w * 0.04, 600);
  ctx.fillText(`${signed(data.pnl, 4)} USDT`, x, h * 0.462);

  // Цены - подпись слева, число в колонке: так их сравнивают глазами, а не
  // выискивают в строке.
  const rows: [string, string][] = [
    ["Цена входа", price(data.entry)],
    ["Цена выхода", data.exit === null ? "-" : price(data.exit)],
  ];
  rows.forEach(([label, value], i) => {
    const y = h * (0.624 + i * 0.036);
    ctx.fillStyle = MUTED;
    ctx.font = face(w * 0.028, 500);
    ctx.fillText(label, x, y);
    ctx.fillStyle = INK;
    ctx.font = face(w * 0.028, 700);
    ctx.fillText(value, x + w * 0.3, y);
  });

  ctx.strokeStyle = "rgba(122, 130, 144, 0.35)";
  ctx.lineWidth = Math.max(1, w * 0.0016);
  ctx.beginPath();
  ctx.moveTo(x, h * 0.69);
  ctx.lineTo(x + w * 0.46, h * 0.69);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = face(w * 0.026, 500);
  ctx.fillText("Дата и время", x, h * 0.736);
  ctx.fillText(stamped(data.at), x + w * 0.3, h * 0.736);

  // Имя владельца - справа вверху, как это делают биржи: карточку показывают
  // другим, и первый вопрос к ней «чьё это».
  if (data.owner) {
    ctx.textAlign = "right";
    ctx.fillStyle = INK;
    ctx.font = face(w * 0.026, 700);
    ctx.fillText(data.owner, w * 0.955, h * 0.052);
  }

  // Нижняя панель: свободное место справа от QR на самой заготовке.
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = face(w * 0.034, 800);
  ctx.fillText("TRADE", w * 0.335, h * 0.842);
  ctx.fillText("WITH US", w * 0.335, h * 0.876);
  ctx.fillStyle = accent;
  ctx.font = face(w * 0.018, 600);
  ctx.fillText("H I G H E R   T O G E T H E R", w * 0.335, h * 0.902);

  ctx.textAlign = "center";
  ctx.fillStyle = FAINT;
  ctx.font = face(w * 0.0155, 600);
  ctx.fillText(
    "TERMINAL  ·  ANALYTICS  ·  COMMUNITY  ·  EDUCATION",
    w / 2,
    h * 0.957,
  );

  if (stamp) drawStamp(ctx, w, h, data.side);
}

/** Загрузить заготовку. Отдельно от рисования: это единственная сеть здесь. */
export function loadBackdrop(side: CardSide): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Заготовка лежит на нашем же домене, но холст, тронутый чужой картинкой,
    // перестаёт отдавать пиксели - а нам их читать и класть в буфер.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Заготовка карточки не загрузилась"));
    image.src = BACKDROP[side];
  });
}

/**
 * Во сколько раз карточка крупнее заготовки.
 *
 * Заготовка приехала в 640 точек шириной - для чата это мало, буквы на ней
 * рассыпаются при первом же увеличении. Рисуем вдвое крупнее: текст выходит
 * чётким по-настоящему, а мягкость подложки в глаза не бросается.
 */
export const SCALE = 2;

/** Готовая карточка холстом. */
export async function render(
  data: CardData,
  stamp: boolean,
  backdrop?: HTMLImageElement,
): Promise<HTMLCanvasElement> {
  const image = backdrop ?? (await loadBackdrop(data.side));
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * SCALE;
  canvas.height = image.naturalHeight * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Холст недоступен");
  paint(ctx, image, canvas.width, canvas.height, data, stamp);
  return canvas;
}
