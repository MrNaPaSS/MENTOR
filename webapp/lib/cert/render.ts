// Сертификат трейдера на холсте.
//
// Бланк - картинка, всё остальное пишется поверх: имя, уровень, столпы, дата и
// номер. Подпись и печать - отдельно: в окне получения их ставит анимация
// поверх листа, а на картинке для буфера и файла их рисует холст (`signed`).
//
// Бланков три, и разметка у них разная: у первого (бронза) строка имени выше,
// у листов серебра и золота линии опущены. Поэтому места - свои на лист
// (`placesOf`), а не одни на всех. Золотой лист тёмный, и чернила там светлые:
// чёрный текст на нём не читается вовсе.

import type { CertPillar } from "@/lib/api";

export const CERT_W = 1491;
export const CERT_H = 1055;

export const SIGNATURE_SRC = "/certificates/signature.png";

export type CertLevel = "bronze" | "silver" | "gold";

/** Бланк уровня. У серебра и золота свои листы, у бронзы - первый, общий. */
export function blankSrc(level: CertLevel): string {
  return level === "bronze" ? "/certificates/blank.jpg" : `/certificates/blank-${level}.jpg`;
}

export function stampSrc(level: CertLevel): string {
  return `/certificates/stamp-${level}.png`;
}

type Places = {
  name: { x: number; y: number; maxW: number };
  pillars: readonly number[];
  pillarY: number;
  date: { x: number; y: number };
  signature: { x: number; y: number; w: number; h: number };
  stamp: { x: number; y: number; size: number };
  number: { x: number; y: number };
};

/** Места на первом бланке (бронза), в точках исходника. */
const FIRST: Places = {
  name: { x: 746, y: 528, maxW: 800 },
  // Сразу под чертой столпа: ниже строка упиралась бы в печать и подпись.
  pillars: [370, 602, 850, 1103],
  pillarY: 726,
  date: { x: 407, y: 836 },
  // Подпись - над своей линией, чуть заходя за её концы, как расписываются.
  signature: { x: 880, y: 742, w: 330, h: 118 },
  // Печать - сразу за подписью, справа от неё: так её и ставят - рядом с
  // росчерком, а не в середине листа между датой и подписью.
  stamp: { x: 1270, y: 800, size: 168 },
  number: { x: 746, y: 968 },
};

/** Места на листах серебра и золота: у них своя разметка, линии ниже. */
const SECOND: Places = {
  name: { x: 748, y: 592, maxW: 820 },
  pillars: [365, 605, 865, 1120],
  // Над иконками столпов, а не под их подписями: под ними проходит зона
  // подписи, и строка последнего столпа оказывалась прямо под росчерком.
  pillarY: 658,
  date: { x: 437, y: 833 },
  signature: { x: 880, y: 748, w: 330, h: 96 },
  // Печать - сразу за подписью, справа от неё.
  stamp: { x: 1190, y: 848, size: 140 },
  // Номер - под линией даты: по центру его закрыла бы печать.
  number: { x: 437, y: 928 },
};

export function placesOf(level: CertLevel): Places {
  return level === "bronze" ? FIRST : SECOND;
}

/** Чернила листа: на тёмном золотом бланке чёрный текст не читается вовсе. */
type Ink = {
  name: string;
  done: string;
  miss: string;
  date: string;
  number: string;
  /** Чем перекрасить подпись. Пусто - рисуем как есть, чернилами автора. */
  signature?: string;
};

const INK: Record<CertLevel, Ink> = {
  bronze: {
    name: "#15171a",
    done: "#0f9e66",
    miss: "#9aa0a6",
    date: "#15171a",
    number: "#8a9096",
  },
  silver: {
    name: "#15171a",
    done: "#0f9e66",
    miss: "#9aa0a6",
    date: "#15171a",
    number: "#8a9096",
  },
  gold: {
    name: "#f6efe0",
    done: "#f0c85f",
    miss: "#8b8272",
    date: "#f6efe0",
    number: "#b3a486",
    // Подпись нарисована тёмно-синим по белому листу: на чёрном с золотом её
    // попросту не видно. Перекрашиваем силуэт, сохраняя нажим и прозрачность.
    signature: "#f2e9d5",
  },
};

export type CertLabels = {
  level: string;
  pillarValues: string[];
  date: string;
  number: string;
};

export type CertData = {
  owner: string;
  level: CertLevel;
  pillars: CertPillar[];
  labels: CertLabels;
};

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  const known = cache.get(src);
  if (known) return known;
  const loading = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => {
      cache.delete(src);
      reject(new Error(`Не загрузилось: ${src}`));
    };
    image.src = src;
  });
  cache.set(src, loading);
  return loading;
}

function face(px: number, weight: number): string {
  return `${weight} ${px}px Inter, "Segoe UI", Roboto, system-ui, sans-serif`;
}

/** Перекрасить непрозрачные точки картинки в один цвет. */
function tinted(image: HTMLImageElement, color: string): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = image.width;
  off.height = image.height;
  const ctx = off.getContext("2d");
  if (ctx) {
    ctx.drawImage(image, 0, 0);
    // Заливка ложится только туда, где у картинки есть точки: форма росчерка
    // и его прозрачность по краям остаются прежними.
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, off.width, off.height);
  }
  return off;
}

/** Строка по центру, ужатая по ширине, если не помещается. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  const width = ctx.measureText(text).width;
  if (width <= maxW) {
    ctx.fillText(text, x, y);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(maxW / width, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export async function renderCert(data: CertData, signed: boolean): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = CERT_W;
  canvas.height = CERT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Холст недоступен");

  const places = placesOf(data.level);
  const ink = INK[data.level];

  const [blank, signature, stamp] = await Promise.all([
    loadImage(blankSrc(data.level)),
    signed ? loadImage(SIGNATURE_SRC) : Promise.resolve(null),
    signed ? loadImage(stampSrc(data.level)) : Promise.resolve(null),
  ]);
  if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;

  ctx.drawImage(blank, 0, 0, CERT_W, CERT_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Имя - главное на листе.
  ctx.fillStyle = ink.name;
  ctx.font = face(58, 800);
  fitText(ctx, data.owner, places.name.x, places.name.y, places.name.maxW);

  // Уровень на листе не подписывается: его называет печать, а строка «столпов
  // 3 из 4» читалась как отметка о недоборе - на сертификате ей не место.

  // Столпы: чем закрыт каждый, под его подписью на бланке.
  ctx.font = face(15, 600);
  data.pillars.forEach((pillar, i) => {
    const x = places.pillars[i];
    if (x === undefined) return;
    ctx.fillStyle = pillar.done ? ink.done : ink.miss;
    const value = data.labels.pillarValues[i] ?? "";
    ctx.fillText(`${pillar.done ? "✓ " : ""}${value}`, x, places.pillarY);
  });

  ctx.fillStyle = ink.date;
  ctx.font = face(22, 600);
  ctx.fillText(data.labels.date, places.date.x, places.date.y);

  ctx.fillStyle = ink.number;
  ctx.font = face(14, 600);
  ctx.fillText(data.labels.number, places.number.x, places.number.y);

  if (signature) {
    const box = places.signature;
    const scale = Math.min(box.w / signature.width, box.h / signature.height);
    const w = signature.width * scale;
    const h = signature.height * scale;
    const art = ink.signature ? tinted(signature, ink.signature) : signature;
    ctx.drawImage(art, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  }

  if (stamp) {
    const { x, y, size } = places.stamp;
    const h = (size * stamp.height) / stamp.width;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((-8 * Math.PI) / 180);
    ctx.globalAlpha = 0.96;
    ctx.drawImage(stamp, -size / 2, -h / 2, size, h);
    ctx.restore();
  }

  return canvas;
}
