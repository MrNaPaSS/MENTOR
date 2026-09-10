// Сертификат трейдера на холсте.
//
// Бланк - картинка, всё остальное пишется поверх: имя, уровень, столпы, дата и
// номер. Подпись и печать - отдельно: в окне получения их ставит анимация
// поверх листа, а на картинке для буфера и файла их рисует холст (`signed`).
//
// Места сняты с линий самого бланка (1491x1055): строка имени на высоте 548,
// линии даты и подписи - на 853, подписи столпов - на 685.

import type { CertPillar } from "@/lib/api";

export const CERT_W = 1491;
export const CERT_H = 1055;

export const BLANK_SRC = "/certificates/blank.jpg";
export const SIGNATURE_SRC = "/certificates/signature.png";

export type CertLevel = "bronze" | "silver" | "gold";

export function stampSrc(level: CertLevel): string {
  return `/certificates/stamp-${level}.png`;
}

/** Места на бланке, в точках исходника. */
export const SPOTS = {
  name: { x: 746, y: 528, maxW: 800 },
  level: { x: 746, y: 588 },
  // Сразу под чертой столпа: ниже строка упиралась бы в печать и подпись.
  pillars: [370, 602, 850, 1103],
  pillarY: 726,
  date: { x: 407, y: 836 },
  // Подпись - над своей линией, чуть заходя за её концы, как расписываются.
  signature: { x: 880, y: 742, w: 330, h: 118 },
  // Печать - посередине между датой и подписью, ниже строки столпов.
  stamp: { x: 726, y: 852, size: 190 },
  number: { x: 746, y: 968 },
} as const;

/** Цвет уровня на бланке: те же металлы, что у печати. */
const LEVEL_INK: Record<CertLevel, string> = {
  bronze: "#8f5424",
  silver: "#56606b",
  gold: "#a0700a",
};

export type CertLabels = {
  level: string;
  levelLine: string;
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

  const [blank, signature, stamp] = await Promise.all([
    loadImage(BLANK_SRC),
    signed ? loadImage(SIGNATURE_SRC) : Promise.resolve(null),
    signed ? loadImage(stampSrc(data.level)) : Promise.resolve(null),
  ]);
  if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;

  ctx.drawImage(blank, 0, 0, CERT_W, CERT_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Имя - главное на листе.
  ctx.fillStyle = "#15171a";
  ctx.font = face(58, 800);
  fitText(ctx, data.owner, SPOTS.name.x, SPOTS.name.y, SPOTS.name.maxW);

  // Уровень под строкой имени, цветом металла печати.
  ctx.fillStyle = LEVEL_INK[data.level];
  ctx.font = face(21, 700);
  ctx.fillText(data.labels.levelLine.toUpperCase(), SPOTS.level.x, SPOTS.level.y);

  // Столпы: чем закрыт каждый, под его подписью на бланке.
  ctx.font = face(15, 600);
  data.pillars.forEach((pillar, i) => {
    const x = SPOTS.pillars[i];
    if (x === undefined) return;
    ctx.fillStyle = pillar.done ? "#0f9e66" : "#9aa0a6";
    const value = data.labels.pillarValues[i] ?? "";
    ctx.fillText(`${pillar.done ? "✓ " : ""}${value}`, x, SPOTS.pillarY);
  });

  ctx.fillStyle = "#15171a";
  ctx.font = face(22, 600);
  ctx.fillText(data.labels.date, SPOTS.date.x, SPOTS.date.y);

  ctx.fillStyle = "#8a9096";
  ctx.font = face(14, 600);
  ctx.fillText(data.labels.number, SPOTS.number.x, SPOTS.number.y);

  if (signature) {
    const box = SPOTS.signature;
    const scale = Math.min(box.w / signature.width, box.h / signature.height);
    const w = signature.width * scale;
    const h = signature.height * scale;
    ctx.drawImage(signature, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  }

  if (stamp) {
    const { x, y, size } = SPOTS.stamp;
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
