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

  // Рамка: заливаем всё её цветом и оставляем поля, а внутрь кладём снимок.
  ctx.fillStyle = palette.frame;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(frame, frame);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, chart.width, chart.height + head + foot);

  ctx.fillStyle = palette.head;
  ctx.fillRect(0, 0, chart.width, head);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = Math.max(1, ratio);
  ctx.beginPath();
  ctx.moveTo(0, head);
  ctx.lineTo(chart.width, head);
  ctx.stroke();

  const pad = 16 * ratio;
  ctx.textBaseline = "middle";

  ctx.fillStyle = palette.text;
  ctx.font = `700 ${17 * ratio}px Inter, system-ui, sans-serif`;
  const symbol = meta.symbol.replace(/USDT$/, "");
  ctx.fillText(symbol, pad, head / 2);

  const width = ctx.measureText(symbol).width;
  ctx.fillStyle = palette.muted;
  ctx.font = `${13 * ratio}px "JetBrains Mono", monospace`;
  ctx.fillText(meta.interval, pad + width + 10 * ratio, head / 2);

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
  ctx.fillText(sign, chart.width - pad, head / 2);
  ctx.textAlign = "left";

  ctx.drawImage(chart, 0, head);

  // Подпись под графиком слева: знак и адрес. По ней снимок узнают, куда бы
  // его ни переслали, - ради этого он и делается ссылкой, а не файлом.
  const baseline = head + chart.height + foot / 2;
  let x = pad;
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
 * Возвращает `false`, когда браузер этого не умеет: копирование картинок есть
 * не везде, и молча ничего не делать здесь нельзя - трейдер решит, что скопировал.
 */
export async function copy(canvas: HTMLCanvasElement): Promise<boolean> {
  const blob = await toBlob(canvas);
  if (!blob || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
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
  return body ? `${API_URL}${body.url}` : null;
}
