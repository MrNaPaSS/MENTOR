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
import { flushShots, keepShot, type QueuedShot } from "./shotQueue";

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
 * Их три, по числу вещей, которые в сделке вообще происходят: вход, ведение -
 * это взятые цели и переносы стопа, - и выход: последняя цель, безубыток или
 * стоп. Всё прочее, что пробовали раньше - «до входа», «разбор», - оказалось
 * тем же входом и тем же выходом, только названным иначе.
 *
 * Снимок, сделанный терминалом самим, знает свой этап без человека: он
 * снимает по событию.
 */
export type ShotStage = "entry" | "manage" | "exit";

export const STAGES: readonly ShotStage[] = ["entry", "manage", "exit"];

/**
 * Этап снимка, снятого до того, как их стало три.
 *
 * Старые снимки никуда не делись, и терять их из-за переименования нельзя:
 * «до входа» - это вход, «разбор» - выход. Незнакомое имя тоже идёт во вход:
 * снимок лучше показать не в том ряду, чем не показать вовсе.
 */
export function stageOf(stage: string | undefined): ShotStage {
  if (stage === "manage") return "manage";
  if (stage === "exit" || stage === "review") return "exit";
  return "entry";
}

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
    return await sendShot({ clientId, image, note, stage, at: Date.now() });
  } catch {
    return null;
  }
}

/** Отправить снимок как есть. Бросает: вызывающий решает, что делать дальше. */
async function sendShot(shot: Omit<QueuedShot, "id">): Promise<TradeShot | null> {
  const token = getAccessToken();
  if (!token) return null;
  return await authReq<TradeShot>(
    `/api/journal/trades/${encodeURIComponent(shot.clientId)}/shots`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ image: shot.image, note: shot.note, stage: shot.stage }),
    },
  );
}

/** Сеть легла, а не сервер отказал: `fetch` в этом случае бросает `TypeError`. */
function networkDown(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return error instanceof TypeError;
}

/**
 * Прикрепить снимок, а если сети нет - отложить до её возвращения.
 *
 * Момент снимка не повторяется: цена ушла, и тот же экран через минуту уже не
 * снять. Поэтому обрыв связи не должен стоить картинки - она ложится в очередь
 * и уходит сама, когда сеть вернётся, хоть бы и после перезагрузки страницы.
 *
 * Отказ сервера - другое дело: не картинка, нет такой сделки, кончилось место.
 * Повторять такой снимок бессмысленно, и в очередь он не попадает.
 */
export async function attachShotSafe(
  clientId: string,
  image: string,
  note = "",
  stage: ShotStage | "" = "",
): Promise<"sent" | "queued" | "failed"> {
  const shot = { clientId, image, note, stage, at: Date.now() };
  try {
    const done = await sendShot(shot);
    return done ? "sent" : "failed";
  } catch (error: unknown) {
    if (!networkDown(error)) return "failed";
    return (await keepShot(shot)) ? "queued" : "failed";
  }
}

/**
 * Отправить отложенные снимки.
 *
 * Зовётся при возвращении сети и при открытии терминала. Снимок, который
 * сервер отверг по существу, из очереди убирается: держать его вечно значит
 * запереть за ним все остальные.
 */
export async function flushPendingShots(): Promise<number> {
  return await flushShots(async (shot) => {
    try {
      await sendShot(shot);
      return true;
    } catch (error: unknown) {
      return !networkDown(error);
    }
  });
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

/**
 * Подписать снимок.
 *
 * Подпись - половина разбора: через месяц по картинке видно свечи, но не
 * видно, что человек тогда думал. Пустой `stage` этап не трогает.
 */
export async function saveShotNote(
  id: number,
  note: string,
  stage: ShotStage | "" = "",
): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  try {
    await authReq<unknown>(`/api/journal/shots/${id}`, token, {
      method: "PUT",
      body: JSON.stringify({ note, stage }),
    });
    return true;
  } catch {
    // Сервер старее этой возможности или отказал: подпись не сохранится, и об
    // этом надо сказать, а не оставить поле с видом записанного.
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
