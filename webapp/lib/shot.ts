"use client";

// Снимок графика: сохранить файлом, положить в буфер, отдать ссылкой.
//
// Само рисование живёт в shotFrame.ts - там ни одного импорта, и эту часть
// можно прогнать в браузере отдельно. Здесь только доставка готовой картинки
// туда, куда её просит трейдер.
//
// Имя трейдера рисуется прямо в картинке и на сервере не хранится: подпись
// нужна тому, кто смотрит, а базе о владельце знать незачем.

import { authReq, API_URL } from "./api";
import { getAccessToken } from "./auth";
import type { ShotMeta } from "./shotFrame";

export { backdrop, composeShot, loadLogo, snapshot, THEMES } from "./shotFrame";
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
  return body ? `${API_URL}${body.url}` : null;
}
