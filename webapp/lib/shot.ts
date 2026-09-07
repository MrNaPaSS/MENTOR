"use client";

// Снимок графика: собрать картинку, сохранить, скопировать, поделиться.
//
// Библиотека графика отдаёт свой холст, но на нём нет ни имени монеты, ни
// таймфрейма, ни времени - того, без чего чужой скриншот бесполезен. Поэтому
// картинка собирается заново: шапка с подписями, под ней сам график.
//
// Имя трейдера рисуется прямо в картинке и на сервере не хранится: подпись
// нужна тому, кто смотрит, а базе о владельце знать незачем.

import { authReq, API_URL } from "./api";
import { getAccessToken } from "./auth";

/** Высота шапки над графиком, пиксели. */
const HEAD = 44;

/** Высота подписи под графиком: логотип и адрес. */
const FOOT = 34;

/** Толщина рамки вокруг снимка. */
const FRAME = 2;

export type ShotMeta = {
  symbol: string;
  interval: string;
  /** Имя трейдера в подписи. Пусто - подписи не будет. */
  author?: string;
  /** Тема снимка: подпись рисуется в цветах графика, а не наоборот. */
  theme: "dark" | "light";
};

const THEMES = {
  // Рамка контрастна теме: тёмный снимок обводится белым, светлый - чёрным.
  // Иначе картинка сливается с фоном переписки, куда её вставляют.
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
 * Логотип для подписи.
 *
 * Загружается один раз и остаётся в памяти: снимок делают подряд, и каждый
 * раз ждать картинку незачем. Не загрузился - подпись обойдётся без знака,
 * но снимок всё равно получится.
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
 * Собрать снимок: холст графика плюс шапка с подписями.
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
  const frame = Math.max(1, Math.round(FRAME * ratio));

  const out = document.createElement("canvas");
  out.width = chart.width + frame * 2;
  out.height = chart.height + head + foot + frame * 2;

  const ctx = out.getContext("2d");
  if (!ctx) return chart;

  // Координаты считаем явно, без сдвига системы координат: сдвинутая система
  // легко уводит рисование за холст, и снимок выходит пустым листом.
  const left = frame;
  const top = frame;

  ctx.fillStyle = palette.frame;
  ctx.fillRect(0, 0, out.width, out.height);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(left, top, chart.width, chart.height + head + foot);

  // Сам график - первым делом: он здесь главное, а подписи вокруг него.
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

  ctx.fillStyle = palette.text;
  ctx.font = `700 ${17 * ratio}px Inter, system-ui, sans-serif`;
  const symbol = meta.symbol.replace(/USDT$/, "");
  ctx.fillText(symbol, left + pad, top + head / 2);

  const width = ctx.measureText(symbol).width;
  ctx.fillStyle = palette.muted;
  ctx.font = `${13 * ratio}px "JetBrains Mono", monospace`;
  ctx.fillText(meta.interval, left + pad + width + 10 * ratio, top + head / 2);

  // Справа - кто и когда. Без этого снимок теряет половину смысла: чужой
  // график без времени невозможно ни проверить, ни обсудить.
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

  // Подпись под графиком слева: знак и адрес. По ней снимок узнают, куда бы
  // его ни переслали, - ради этого он и делается ссылкой, а не файлом.
  const baseline = top + head + chart.height + foot / 2;
  let x = left + pad;
  const badge = mark ?? logo;
  if (badge) {
    const size = 20 * ratio;
    ctx.drawImage(badge, x, baseline - size / 2, size, size);
    x += size + 8 * ratio;
  }
  ctx.fillStyle = palette.text;
  ctx.font = `700 ${13 * ratio}px Inter, system-ui, sans-serif`;
  ctx.fillText("NMNH.TRADE", x, baseline);

  return out;
}

/**
 * Есть ли на холсте хоть что-то, кроме одного сплошного цвета.
 *
 * Пустой снимок выглядит как обычная картинка: файл на месте, размеры верные,
 * а внутри белый лист. Отличить это можно только по точкам, поэтому проверяем
 * их сами - по редкой сетке, чтобы не читать миллионы пикселей зря.
 */
export function hasContent(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) return false;

  try {
    const step = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / 40));
    let first: string | null = null;
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
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

/** Холст в PNG. Промис, потому что кодирование идёт вне основного потока. */
export function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Сохранить снимок файлом. */
export async function download(canvas: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await toBlob(canvas);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.png`;
  link.click();
  // Освобождаем сразу: браузер уже забрал данные, а ссылка живёт до перезагрузки.
  URL.revokeObjectURL(url);
}

/**
 * Скопировать снимок в буфер обмена.
 *
 * Принимает не готовую картинку, а обещание её собрать - и это важно. Право
 * писать в буфер браузер даёт только по свежему нажатию: любое ожидание между
 * кликом и записью его снимает, и запись молча отклоняется. Поэтому запись
 * начинается сразу, а картинка доезжает внутрь неё сама.
 *
 * Возвращает `false`, когда браузер этого не умеет или отказал: молча ничего
 * не делать здесь нельзя - трейдер решит, что скопировал, и вставит старое.
 */
export function copy(picture: Promise<HTMLCanvasElement>): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return Promise.resolve(false);
  }

  const png = picture.then(async (canvas) => {
    const blob = await toBlob(canvas);
    if (!blob) throw new Error("снимок не собрался");
    return blob;
  });

  return navigator.clipboard
    .write([new ClipboardItem({ "image/png": png })])
    .then(() => true)
    .catch(() => false);
}

/**
 * Выложить снимок и получить ссылку.
 *
 * Ссылка открывается страницей с картинкой и подписью, а в мессенджерах
 * разворачивается превью. Полный адрес собираем сами: сервер знает только свой
 * путь, а делятся ссылкой снаружи.
 */
export async function share(
  canvas: HTMLCanvasElement,
  meta: ShotMeta,
): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;

  const body = await authReq<{ id: string; url: string }>("/api/shots", token, {
    method: "POST",
    body: JSON.stringify({
      image: canvas.toDataURL("image/png"),
      symbol: meta.symbol,
      interval: meta.interval,
    }),
  });
  if (!body) return null;
  // Сервер может отдать готовый адрес: тогда снимки живут на своём домене, и
  // подставлять адрес приложения нельзя.
  return /^https?:\/\//.test(body.url) ? body.url : `${API_URL}${body.url}`;
}
