"use client";

// Снимок графика: сохранить файлом, положить в буфер, отдать ссылкой.
//
// Само рисование живёт в shotFrame.ts - там ни одного импорта, и эту часть
// можно прогнать в браузере отдельно. Здесь только доставка готовой картинки
// туда, куда её просит трейдер.
//
// Имя трейдера рисуется прямо в картинке и на сервере не хранится: подпись
// нужна тому, кто смотрит, а базе о владельце знать незачем.

import { dict } from "@/lib/i18n";
import { absolute, authReq, API_URL } from "./api";
import { getAccessToken } from "./auth";
import type { ShotMeta } from "./shotFrame";

export { backdrop, composeShot, snapshot, THEMES } from "./shotFrame";
export type { ShotMeta, ShotResult, ShotSource, ShotTheme } from "./shotFrame";

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
  // Освобождаем не сразу: браузер забирает данные не в этот же миг, и ссылка,
  // отозванная слишком рано, оставляет трейдера без файла.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Скопировать снимок в буфер обмена.
 *
 * Принимает обещание картинки, а не готовую: право писать в буфер браузер даёт
 * только на свежее нажатие, и любое ожидание между кликом и записью его
 * снимает. Поэтому запись начинается сразу, а картинка доезжает внутрь неё.
 *
 * Возвращает `false`, когда браузер не умеет или отказал: молчать нельзя -
 * трейдер решит, что скопировал, и вставит то, что лежало в буфере раньше.
 */
export function copy(picture: Promise<HTMLCanvasElement>): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return Promise.resolve(false);
  }

  const png = picture.then(async (canvas) => {
    const blob = await toBlob(canvas);
    if (!blob) throw new Error(dict().pnlCard.shotNotAssembled);
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
  const saved = await upload(canvas, meta);
  return saved ? saved.url : null;
}

/**
 * Каким снимок уходит по ссылке: не крупнее полутора тысяч точек по ширине.
 *
 * Холст собирается в точках экрана, а их на каждую точку разметки приходится
 * полторы-две: на рабочем столе с плотным экраном снимок выходил под четыре
 * тысячи точек в ширину и десять мегабайт в PNG. Страница показывает его в
 * тысячу двести, ссылку ждали полминуты, а сервер такое и вовсе отвергал.
 *
 * Файлом и в буфер снимок по-прежнему уходит во всю величину и без потерь -
 * там вес не платится каналом.
 */
const SHARE_MAX_W = 1600;
const SHARE_MAX_H = 900;

function forShare(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(1, SHARE_MAX_W / canvas.width, SHARE_MAX_H / canvas.height);
  if (scale >= 1) return canvas;

  const small = document.createElement("canvas");
  small.width = Math.round(canvas.width * scale);
  small.height = Math.round(canvas.height * scale);
  const ctx = small.getContext("2d");
  if (!ctx) return canvas;
  // Сглаживание в полную силу: свечи в один пиксель при уменьшении рассыпаются
  // в крошку, и график перестаёт читаться ровно там, где на него смотрят.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return small;
}

/**
 * Тот же снимок, но с его именем.
 *
 * Ссылку хватает тому, кто отправляет её людям. Чату мало: в ленте снимок
 * показывается картинкой, а открывается страницей, и адреса нужны оба.
 */
export async function upload(
  canvas: HTMLCanvasElement,
  meta: ShotMeta,
): Promise<{ id: string; url: string; image: string } | null> {
  const token = getAccessToken();
  if (!token) return null;

  const body = await authReq<{ id: string; url: string }>("/api/shots", token, {
    method: "POST",
    body: JSON.stringify({
      image: forShare(canvas).toDataURL("image/jpeg", 0.9),
      symbol: meta.symbol,
      interval: meta.interval,
    }),
  });
  if (!body) return null;
  return { id: body.id, url: absolute(body.url), image: `${API_URL}/${body.id}.png` };
}
