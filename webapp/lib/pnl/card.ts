"use client";

// Карточка сделки: рисование на холсте.
//
// Такие карточки трейдеры отправляют друг другу вместо слов - на них видно и
// монету, и сторону, и во сколько раз вырос залог. У бирж они есть у всех, и
// человек, пришедший от биржи, ищет её и здесь.
//
// Фон - готовая картинка. Их четыре: по одной на сочетание темы терминала и
// стороны сделки. Выбора у человека нет и не нужно - карточка часть того же
// рабочего места, что и график, и своя настройка ей ни к чему.
//
// Всё остальное рисуется поверх, поэтому файл не знает
// ни про React, ни про сеть: холст, кисть и арифметика. Так карточку можно
// собрать где угодно - в окне журнала, при копировании в буфер, при
// выкладывании ссылкой - одним и тем же кодом, и картинка везде выйдет одна.
//
// Все размеры - доли, а не пиксели, и почти все привязаны не к краю картинки,
// а к нарисованным на ней рамкам: у разных заготовок и рамка печати, и нижняя
// панель стоят по-разному, а раскладка обязана садиться на них, а не рядом.

export type CardSide = "long" | "short";

/** Тема терминала: она и решает, на какой заготовке рисовать. */
export type CardTheme = "dark" | "light";

/** Прямоугольник в долях ширины и высоты заготовки. */
export type Frame = { x: number; y: number; w: number; h: number };

export type Variant = {
  id: string;
  side: CardSide;
  /** Под какой темой терминала эта заготовка идёт в дело. */
  theme: CardTheme;
  src: string;
  /** Рамка под печать - та, что нарисована в левом верхнем углу. */
  stamp: Frame;
  /** Нижняя панель с QR: от неё считается вся её начинка. */
  panel: Frame;
  /** Цвет чисел. По стороне сделки: заготовки нарисованы под неё. */
  accent: string;
  /** Цвет печати. Обычно тот же, но у заготовки бывают свои рамки. */
  ink: string;
  /**
   * Светлое ли само полотно.
   *
   * Это не то же, что тема: у светлой темы шорт нарисован на тёмном холсте.
   * От яркости полотна зависят чернила и то, гасим мы фон под числами или,
   * наоборот, высветляем.
   */
  paper: "light" | "dark";
};

/**
 * Заготовки: по одной на сочетание темы и стороны.
 *
 * Доли сняты с самих картинок по нарисованным на них рамкам - иначе печать
 * села бы мимо своего места, а надписи нижней панели наехали на QR.
 */
export const VARIANTS: readonly Variant[] = [
  {
    id: "bull",
    side: "long",
    theme: "dark",
    src: "/pln/card-long.jpg",
    // 640x852: рамка 20..391 x 23..112, панель 18..617 x 668..831.
    stamp: { x: 20 / 640, y: 23 / 852, w: 371 / 640, h: 89 / 852 },
    panel: { x: 18 / 640, y: 668 / 852, w: 599 / 640, h: 163 / 852 },
    accent: "#22E07A",
    ink: "#22E07A",
    paper: "dark",
  },
  {
    id: "bear",
    side: "short",
    theme: "dark",
    src: "/pln/card-short.jpg",
    stamp: { x: 20 / 638, y: 23 / 852, w: 371 / 638, h: 89 / 852 },
    panel: { x: 18 / 638, y: 668 / 852, w: 599 / 638, h: 163 / 852 },
    accent: "#FF3B4E",
    ink: "#FF3B4E",
    paper: "dark",
  },
  {
    id: "chart-long",
    side: "long",
    theme: "light",
    src: "/pln/card-long-light.jpg",
    // 587x781: рамка 20..359 x 19..103, панель 19..567 x 612..762.
    stamp: { x: 20 / 587, y: 19 / 781, w: 339 / 587, h: 84 / 781 },
    panel: { x: 19 / 587, y: 612 / 781, w: 548 / 587, h: 150 / 781 },
    // Глубже, чем мята на самой заготовке: светлая мята на белом не читается,
    // а числа здесь - главное, что с карточки забирают глазами.
    accent: "#0F9E66",
    ink: "#0F9E66",
    paper: "light",
  },
  {
    id: "chart-short",
    side: "short",
    theme: "light",
    src: "/pln/card-short-dark.jpg",
    // 586x780: рамка 18..355 x 17..97, панель 16..565 x 592..741.
    stamp: { x: 18 / 586, y: 17 / 780, w: 337 / 586, h: 80 / 780 },
    panel: { x: 16 / 586, y: 592 / 780, w: 549 / 586, h: 149 / 780 },
    // Числа красные - это шорт, и падающие свечи на заготовке говорят то же.
    // А печать мятная: мятой на этой картинке нарисованы все рамки, и красный
    // оттиск встал бы на ней чужим.
    accent: "#FF4D5E",
    ink: "#02FBC6",
    paper: "dark",
  },
] as const;

/**
 * Цвет результата: плюс зелёный, минус красный.
 *
 * Не цвет стороны. Сторона говорит, куда трейдер встал, а число под ней -
 * сколько он на этом получил, и это разные вещи: убыточный лонг рисовался
 * зелёным, потому что он лонг. На карточке, которую показывают другим,
 * знак результата должен читаться с одного взгляда.
 *
 * Оттенки разные по бумаге: на белом светлая мята не читается, нужен глубже.
 */
const RESULT = {
  dark: { up: "#22E07A", down: "#FF3B4E" },
  light: { up: "#0F9E66", down: "#D6203A" },
} as const;

export function resultInk(paper: "light" | "dark", pnl: number): string {
  return RESULT[paper][pnl >= 0 ? "up" : "down"];
}

/**
 * Заготовка под тему и сторону.
 *
 * Выбирать её человеку не даём: карточка - часть того же рабочего места, что и
 * график, и переключать её отдельно значит держать в голове ещё одну
 * настройку. Тема уже сказала всё, что нужно.
 */
export function variantFor(theme: CardTheme, side: CardSide): Variant {
  return (
    VARIANTS.find((v) => v.theme === theme && v.side === side) ??
    VARIANTS.find((v) => v.side === side) ??
    VARIANTS[0]
  );
}

export type CardData = {
  symbol: string;
  side: CardSide;
  leverage: number;
  /** Доход в процентах от залога. */
  roi: number;
  /** Доход в USDT - тот, что пришёл на счёт, уже за вычетом комиссии. */
  pnl: number;
  entry: number;
  /** Цена выхода. `null` - выхода в отчёте биржи ещё нет. */
  exit: number | null;
  /** Когда сделка закрылась, ISO. */
  at: string;
  /** Имя владельца. Пусто - подписи не будет. */
  owner?: string;
};

/** Чернила заготовки: на светлой они тёмные, на тёмной светлые. */
function palette(variant: Variant) {
  return variant.paper === "light"
    ? { ink: "#0E1116", muted: "#59626E", faint: "#6B7480", veil: "252, 253, 254" }
    : { ink: "#F2F4F7", muted: "#8A93A0", faint: "#7C8794", veil: "4, 7, 10" };
}

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

/**
 * Часовой пояс того, кто собирает карточку.
 *
 * Без него время на карточке ничего не значит: одна и та же сделка у трейдера
 * в Москве и у того, кому он её отправил, приходится на разные часы, и спор
 * «когда это было» решать нечем.
 */
function zone(at: Date): string {
  // На восток от Гринвича смещение отрицательное - знак разворачиваем.
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const tail = rest ? `:${String(rest).padStart(2, "0")}` : "";
  return `UTC${sign}${hours}${tail}`;
}

/** Время карточки - по часам того, кто её собирает, и с их поясом. */
function stamped(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())} ` +
    zone(at)
  );
}

/**
 * Приглушение под левой колонкой.
 *
 * Числа стоят слева, а на заготовке там то лапа зверя, то граффити, то кусок
 * стакана: «0,16350» ложилось прямо на них и не читалось. Полоса идёт от края
 * к середине и не трогает ни рамку печати сверху, ни панель снизу - там своя
 * графика, и гасить её незачем. На светлой заготовке это высветление, а не
 * затемнение: чернила там тёмные.
 */
function veil(ctx: CanvasRenderingContext2D, w: number, h: number, variant: Variant): void {
  const tone = palette(variant).veil;
  const top = (variant.stamp.y + variant.stamp.h) * h + h * 0.02;
  const bottom = variant.panel.y * h - h * 0.01;
  const gradient = ctx.createLinearGradient(0, 0, w * 0.62, 0);
  gradient.addColorStop(0, `rgba(${tone}, 0.88)`);
  gradient.addColorStop(0.55, `rgba(${tone}, 0.5)`);
  gradient.addColorStop(1, `rgba(${tone}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, top, w * 0.62, bottom - top);
}

/** Печать NMNH: та, что падает в рамку. */
export function drawStamp(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  variant: Variant,
): void {
  const box = {
    x: variant.stamp.x * w,
    y: variant.stamp.y * h,
    w: variant.stamp.w * w,
    h: variant.stamp.h * h,
  };

  ctx.save();
  // Печать садится не по линейке: ровно вписанная в рамку, она выглядит
  // напечатанной вместе с бланком, а не поставленной поверх.
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.rotate((-4.5 * Math.PI) / 180);
  ctx.globalAlpha = 0.9;

  const iw = box.w * 0.92;
  const ih = box.h * 0.86;
  ctx.strokeStyle = variant.ink;
  ctx.lineWidth = Math.max(2, w * 0.005);
  ctx.strokeRect(-iw / 2, -ih / 2, iw, ih);
  ctx.lineWidth = Math.max(1, w * 0.0018);
  ctx.strokeRect(-iw / 2 + ih * 0.12, -ih / 2 + ih * 0.12, iw - ih * 0.24, ih - ih * 0.24);

  ctx.fillStyle = variant.ink;
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
  variant: Variant,
  stamp: boolean,
): void {
  const { ink, muted, faint } = palette(variant);
  ctx.drawImage(backdrop, 0, 0, w, h);
  veil(ctx, w, h, variant);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const x = w * 0.075;
  // Колонка начинается под рамкой печати и кончается над панелью, а не на
  // глазок: у заготовок и то, и другое стоит на разной высоте.
  const head = (variant.stamp.y + variant.stamp.h) * h;
  const room = variant.panel.y * h - head;

  ctx.fillStyle = ink;
  ctx.font = face(w * 0.062, 800);
  ctx.fillText(data.symbol, x, head + room * 0.19);

  // Строка стороны - цветом заготовки: она про то, куда встали.
  ctx.fillStyle = variant.accent;
  ctx.font = face(w * 0.036, 600);
  const side = data.side === "long" ? "Лонг" : "Шорт";
  ctx.fillText(`${side}   |   ${data.leverage}x`, x, head + room * 0.27);

  // А числа - цветом результата: плюс зелёный, минус красный, независимо от
  // того, лонг это был или шорт.
  ctx.fillStyle = resultInk(variant.paper, data.pnl);
  ctx.font = face(w * 0.098, 800);
  ctx.fillText(`${signed(data.roi, 2)}%`, x, head + room * 0.46);

  ctx.font = face(w * 0.04, 600);
  ctx.fillText(`${signed(data.pnl, 4)} USDT`, x, head + room * 0.53);

  // Цены - подпись слева, число в колонке: так их сравнивают глазами, а не
  // выискивают в строке.
  const rows: [string, string][] = [
    ["Цена входа", price(data.entry)],
    ["Цена выхода", data.exit === null ? "-" : price(data.exit)],
  ];
  rows.forEach(([label, value], i) => {
    const y = head + room * (0.79 + i * 0.055);
    ctx.fillStyle = muted;
    ctx.font = face(w * 0.028, 500);
    ctx.fillText(label, x, y);
    ctx.fillStyle = ink;
    ctx.font = face(w * 0.028, 700);
    ctx.fillText(value, x + w * 0.3, y);
  });

  ctx.strokeStyle = variant.paper === "light" ? "rgba(14, 17, 22, 0.22)" : "rgba(122, 130, 144, 0.35)";
  ctx.lineWidth = Math.max(1, w * 0.0016);
  ctx.beginPath();
  ctx.moveTo(x, head + room * 0.89);
  ctx.lineTo(x + w * 0.46, head + room * 0.89);
  ctx.stroke();

  ctx.fillStyle = muted;
  ctx.font = face(w * 0.026, 500);
  ctx.fillText("Дата и время", x, head + room * 0.96);
  // Чуть мельче остальных строк: к дате прибавился пояс, и прежним кеглем
  // строка заезжала на картинку.
  ctx.font = face(w * 0.024, 500);
  ctx.fillText(stamped(data.at), x + w * 0.3, head + room * 0.96);

  // Имя владельца - справа вверху и на подложке, как это делают биржи.
  //
  // Подложка не украшение: за именем идёт то город со свечами, то мазки
  // краски, и буквы поверх них то читались, то нет - в зависимости от того,
  // что оказалось под ними. Плашка отвечает за это сама, чего бы ни
  // нарисовали на заготовке.
  if (data.owner) {
    const size = w * 0.026;
    const at = (variant.stamp.y + variant.stamp.h * 0.55) * h;
    ctx.font = face(size, 700);
    const padX = size * 0.62;
    const padY = size * 0.42;
    const width = ctx.measureText(data.owner).width + padX * 2;
    const height = size + padY * 2;
    const right = w * 0.955;

    ctx.fillStyle = variant.paper === "light" ? "rgba(252, 253, 254, 0.78)" : "rgba(6, 10, 14, 0.66)";
    ctx.strokeStyle = variant.paper === "light" ? "rgba(14, 17, 22, 0.18)" : "rgba(242, 244, 247, 0.16)";
    ctx.lineWidth = Math.max(1, w * 0.0015);
    ctx.beginPath();
    ctx.roundRect(right - width, at - size * 0.78 - padY, width, height, height / 2);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.fillText(data.owner, right - padX, at);
  }

  // Нижняя панель: свободное место справа от QR на самой заготовке. Считаем от
  // самой панели - у заготовок она и на разной высоте, и разной толщины.
  const panel = {
    x: variant.panel.x * w,
    y: variant.panel.y * h,
    w: variant.panel.w * w,
    h: variant.panel.h * h,
  };
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.font = face(w * 0.034, 800);
  ctx.fillText("TRADE", panel.x + panel.w * 0.328, panel.y + panel.h * 0.303);
  ctx.fillText("WITH US", panel.x + panel.w * 0.328, panel.y + panel.h * 0.481);
  ctx.fillStyle = variant.accent;
  ctx.font = face(w * 0.018, 600);
  ctx.fillText(
    "H I G H E R   T O G E T H E R",
    panel.x + panel.w * 0.328,
    panel.y + panel.h * 0.617,
  );

  ctx.textAlign = "center";
  ctx.fillStyle = faint;
  ctx.font = face(w * 0.0155, 600);
  ctx.fillText(
    "TERMINAL  ·  ANALYTICS  ·  COMMUNITY  ·  EDUCATION",
    panel.x + panel.w / 2,
    panel.y + panel.h * 0.904,
  );

  if (stamp) drawStamp(ctx, w, h, variant);
}

/** Загрузить заготовку. Отдельно от рисования: это единственная сеть здесь. */
export function loadBackdrop(variant: Variant): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Заготовка лежит на нашем же домене, но холст, тронутый чужой картинкой,
    // перестаёт отдавать пиксели - а нам их читать и класть в буфер.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Заготовка карточки не загрузилась"));
    image.src = variant.src;
  });
}

/**
 * Во сколько раз карточка крупнее заготовки.
 *
 * Заготовки приехали шириной в шесть сотен точек - для чата это мало, буквы на
 * них рассыпаются при первом же увеличении. Рисуем вдвое крупнее: текст выходит
 * чётким по-настоящему, а мягкость подложки в глаза не бросается.
 */
export const SCALE = 2;

/** Готовая карточка холстом. */
export async function render(
  data: CardData,
  variant: Variant,
  stamp: boolean,
  backdrop?: HTMLImageElement,
): Promise<HTMLCanvasElement> {
  const image = backdrop ?? (await loadBackdrop(variant));
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth * SCALE;
  canvas.height = image.naturalHeight * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Холст недоступен");
  paint(ctx, image, canvas.width, canvas.height, data, variant, stamp);
  return canvas;
}
