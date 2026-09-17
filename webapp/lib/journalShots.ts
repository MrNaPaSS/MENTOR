"use client";

// Снимки разбора: картинки, прикреплённые к сделке журнала.
//
// Разбор сделки задним числом - это разговор о картинке: где был вход, что
// стояло в стакане, как выглядел график до и после. Снимок делают в работе, а
// не после закрытия, поэтому прикрепить его можно и к идущей сделке.
//
// Картинка отправляется data-URL - тем же путём, каким уходят снимки графика
// и карточки сделок. Ссылка на неё открывается без входа: это обычный снимок,
// такой же, каким делятся в чате.

import { API_URL, authReq } from "./api";
import { getAccessToken } from "./auth";

/** Снимок в строке журнала. */
export type TradeShot = {
  /** Номер связи: по нему снимок откреплять. */
  id: number;
  /** Опознаватель картинки: он же адрес её страницы. */
  shot_id: string;
  note: string;
};

/** Адрес самой картинки. */
export function shotImage(shot: { shot_id: string }): string {
  return `${API_URL}/${shot.shot_id}.png`;
}

/** Адрес страницы снимка: ею делятся ссылкой. */
export function shotPage(shot: { shot_id: string }): string {
  return `${API_URL}/${shot.shot_id}`;
}

/**
 * Прикрепить картинку к сделке.
 *
 * `image` - data-URL: из буфера обмена, с диска или с холста графика. Сервер
 * сам решает, PNG это или JPEG, и отказывает, если прислали не картинку.
 */
export async function attachShot(
  clientId: string,
  image: string,
  note = "",
): Promise<TradeShot | null> {
  const token = getAccessToken();
  if (!token) return null;
  return authReq<TradeShot>(
    `/api/journal/trades/${encodeURIComponent(clientId)}/shots`,
    token,
    { method: "POST", body: JSON.stringify({ image, note }) },
  );
}

/** Прикрепить снимок, который уже лежит на сервере. */
export async function attachExisting(
  clientId: string,
  shotId: string,
  note = "",
): Promise<TradeShot | null> {
  const token = getAccessToken();
  if (!token) return null;
  return authReq<TradeShot>(
    `/api/journal/trades/${encodeURIComponent(clientId)}/shots`,
    token,
    { method: "POST", body: JSON.stringify({ shot_id: shotId, note }) },
  );
}

/**
 * Переставить снимки: весь порядок целиком, от первого к последнему.
 *
 * Не «поменяй эти два местами»: список короткий, а обмен парами расходится с
 * экраном на первой же гонке - две перестановки подряд оставляли снимки не
 * там, куда их положили.
 */
export async function orderShots(clientId: string, ids: number[]): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  const done = await authReq<unknown>(
    `/api/journal/trades/${encodeURIComponent(clientId)}/shots/order`,
    token,
    { method: "PUT", body: JSON.stringify({ ids }) },
  );
  return done !== null;
}

/** Открепить снимок. Файл остаётся: на него могла уйти ссылка. */
export async function detachShot(id: number): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  const done = await authReq<unknown>(`/api/journal/shots/${id}`, token, {
    method: "DELETE",
  });
  return done !== null;
}

/**
 * Картинка из события вставки - в data-URL.
 *
 * Снимок экрана в буфере обмена - обычное дело: нажал PrtSc, переключился в
 * терминал, вставил. Читаем только картинки: вставленный текст к сделке
 * прикреплять нечем, и молча превращать его в пустой снимок нельзя.
 */
export function pastedImage(event: ClipboardEvent): Promise<string | null> {
  const items = Array.from(event.clipboardData?.items ?? []);
  const picture = items.find((one) => one.type.startsWith("image/"));
  const file = picture?.getAsFile();
  return file ? readImage(file) : Promise.resolve(null);
}

/** Файл с диска - в data-URL. Не картинка - ничего. */
export function readImage(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  return new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => done(null);
    reader.readAsDataURL(file);
  });
}
