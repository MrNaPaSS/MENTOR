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
  /** Этап сделки, к которому относится снимок. Пусто - этап не назван. */
  stage?: ShotStage | "";
};

/**
 * Этап сделки, к которому относится снимок.
 *
 * Порядок здесь задаёт порядок на экране: до входа, вход, ведение, выход,
 * разбор. Снимок, сделанный терминалом самим, знает свой этап без человека -
 * он снимает по событию.
 */
export type ShotStage = "before" | "entry" | "manage" | "exit" | "review";

export const STAGES: readonly ShotStage[] = [
  "before",
  "entry",
  "manage",
  "exit",
  "review",
];

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
  stage: ShotStage | "" = "",
): Promise<TradeShot | null> {
  const token = getAccessToken();
  if (!token) return null;
  // Отказ сервера прилетает исключением: без перехвата кнопка молча ничего не
  // делает, и человек решает, что сломался экран. Возвращаем пустоту - о ней
  // окно скажет словами.
  try {
    return await authReq<TradeShot>(
      `/api/journal/trades/${encodeURIComponent(clientId)}/shots`,
      token,
      { method: "POST", body: JSON.stringify({ image, note, stage }) },
    );
  } catch {
    return null;
  }
}

/** Прикрепить снимок, который уже лежит на сервере. */
export async function attachExisting(
  clientId: string,
  shotId: string,
  note = "",
): Promise<TradeShot | null> {
  const token = getAccessToken();
  if (!token) return null;
  try {
    return await authReq<TradeShot>(
      `/api/journal/trades/${encodeURIComponent(clientId)}/shots`,
      token,
      { method: "POST", body: JSON.stringify({ shot_id: shotId, note }) },
    );
  } catch {
    return null;
  }
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
  try {
    await authReq<unknown>(
      `/api/journal/trades/${encodeURIComponent(clientId)}/shots/order`,
      token,
      { method: "PUT", body: JSON.stringify({ ids }) },
    );
    return true;
  } catch {
    // Сервер старее этой возможности или отказал: порядок не поменяется, и об
    // этом надо сказать, а не оставить кнопку без ответа.
    return false;
  }
}

/** Открепить снимок. Файл остаётся: на него могла уйти ссылка. */
export async function detachShot(id: number): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  try {
    await authReq<unknown>(`/api/journal/shots/${id}`, token, { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
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

/**
 * Разбор сделки: слова, отметка дисциплины и нарушения.
 *
 * Поля необязательные: разбор пишут в несколько заходов - сперва отметил
 * нарушение, через час дописал словами, - и присланное целиком затирало бы
 * написанное раньше.
 */
export async function saveReview(
  clientId: string,
  body: { review?: string; plan_ok?: boolean | null; mistakes?: string[] },
): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  try {
    await authReq<unknown>(
      `/api/journal/trades/${encodeURIComponent(clientId)}/review`,
      token,
      { method: "PUT", body: JSON.stringify(body) },
    );
    return true;
  } catch {
    return false;
  }
}

/** Нарушения правил: те же коды, что считает сервер. */
export const MISTAKES = ["late", "risk", "session", "average", "fomo", "plan"] as const;

export type Mistake = (typeof MISTAKES)[number];
