"use client";

// Карточка наружу: в буфер, файлом и ссылкой.
//
// Рисование живёт в card.ts и о сети не знает вовсе. Здесь только доставка -
// и одно правило, из-за которого эти две вещи нельзя мешать: право писать в
// буфер обмена браузер даёт на свежее нажатие и отбирает при первом же
// ожидании. Поэтому запись в буфер начинается сразу, а картинка доезжает
// внутрь уже начатой записи.

import { dict } from "@/lib/i18n";
import { absolute, authReq } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

import { resultInk, sealFrame } from "./card";
import type { CardData, Variant } from "./card";

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Скачать карточку файлом. */
export async function download(canvas: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await toBlob(canvas);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.png`;
  link.click();
  // Освобождаем не сразу: браузер забирает данные не в этот же миг.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Положить карточку в буфер обмена.
 *
 * Принимает обещание, а не готовый холст: см. про свежее нажатие выше.
 * `false` - браузер не умеет или отказал. Молчать нельзя: трейдер решит, что
 * скопировал, и вставит в чат то, что лежало в буфере до этого.
 */
export function copy(picture: Promise<HTMLCanvasElement>): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    return Promise.resolve(false);
  }
  const png = picture.then(async (canvas) => {
    const blob = await toBlob(canvas);
    if (!blob) throw new Error(dict().pnlCard.notAssembled);
    return blob;
  });
  return navigator.clipboard
    .write([new ClipboardItem({ "image/png": png })])
    .then(() => true)
    .catch(() => false);
}

/**
 * Выложить карточку и получить ссылку.
 *
 * Уходят обе картинки: с печатью - её показывает превью в мессенджере и её же
 * скачивают, и без печати - её страница печатает движением, а печать ставит
 * уже сама. Собрать вторую из первой нельзя: оттиск непрозрачен.
 */
export async function share(
  stamped: HTMLCanvasElement,
  plain: HTMLCanvasElement,
  data: CardData,
  variant: Variant,
): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;

  // Заметка складывается из того, что и так стоит на карточке: одним бланком
  // делятся и сделкой, и итогом срока, и «Шорт BTCUSDT» подошло бы только
  // первому.
  const note = `${data.subtitle} ${data.title} ${data.roi >= 0 ? "+" : ""}${data.roi.toFixed(2)}%`;

  const body = await authReq<{ id: string; url: string }>("/api/shots/pnl", token, {
    method: "POST",
    body: JSON.stringify({
      // JPEG, а не PNG: тот же бланк в PNG весит на порядок больше, и на
      // медленном канале выкладка карточки занимала минуты. В буфер и файлом
      // карточка по-прежнему уходит PNG - там вес не платится каналом.
      image: stamped.toDataURL("image/jpeg", 0.92),
      raw: plain.toDataURL("image/jpeg", 0.92),
      symbol: data.title,
      side: data.side,
      owner: data.owner ?? "",
      note,
      // Куда странице ставить печать и каким цветом. Отправляем числами, а не
      // именем заготовки: иначе те же доли пришлось бы держать ещё и на
      // сервере, и они бы разошлись при первой же новой картинке.
      card: {
        variant: variant.id,
        ink: resultInk(variant.paper, data.pnl),
        stamp: variant.stamp,
        // Оттиск на планете нижней панели: где стоит, чем светится и на каком
        // полотне - от полотна зависит, тёмным он будет или белым.
        seal: sealFrame(variant),
        glow: variant.ink,
        paper: variant.paper,
        // Биржа сделки: страница ставит её под печатью, как холст.
        venue: data.venue ?? "",
      },
    }),
  });
  return body ? absolute(body.url) : null;
}
