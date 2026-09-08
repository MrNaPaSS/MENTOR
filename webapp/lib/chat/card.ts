"use client";

// Карточка к сделке, которой делятся в чате.
//
// Нужна не самому чату - в ленте сделка и так рисуется живой карточкой, - а
// тем, кто читает разговор снаружи: в форуме Telegram сообщение от бота это
// текст, и без картинки сделка там выглядит строкой цифр среди других строк.
//
// Бланков два, и выбор между ними не про оформление.
//
// Ждущая заявка и сделка в рынке - это намерение: куда встали, где стоп, куда
// идём. Их печатает бланк сигнала, и печать заверяет, что заявка была
// выставлена именно такой и именно тогда.
//
// Закрытая сделка - это итог, и у неё уже есть свой бланк: карточка результата
// из терминала. Печатать план по сделке, которая закончилась, значит показывать
// намерение там, где спрашивают о результате.
//
// Выложенная карточка ложится в то же хранилище снимков: у страницы с печатью
// уже есть и превью для мессенджеров, и движение печати, и кнопка в терминал.
//
// Ошибка здесь никогда не отменяет сообщение. Не собралась картинка - сделка
// уйдёт в чат без ссылки: разговор важнее иллюстрации к нему.

import { authReq, API_URL } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { defaultVariant, render } from "@/lib/pnl/card";
import { cardFromShared } from "@/lib/pnl/data";
import { share as publishCard } from "@/lib/pnl/share";
import { renderSignal, templateFor, type SignalSide } from "@/lib/signal/card";

import type { SharedTrade } from "./api";

/** Ссылка на страницу карточки и на саму картинку. */
export type CardLink = { url: string; image: string };

function toBlobUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

/**
 * Выложить бланк сигнала и получить ссылку.
 *
 * Уходят обе картинки: с печатью - её показывает превью в мессенджере и её же
 * скачивают, и без печати - её страница печатает движением, а оттиск роняет
 * сверху уже сама. Собрать вторую из первой нельзя: оттиск непрозрачен.
 */
async function publishSignal(trade: SharedTrade, at: string): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;

  const side = trade.side as SignalSide;
  const template = templateFor(side);
  const targets = (trade.targets ?? []).filter((v) => Number.isFinite(v) && v > 0);
  const data = {
    symbol: trade.symbol,
    side,
    leverage: trade.leverage,
    entry: trade.entry,
    stop: trade.stop,
    target: targets.length > 0 ? targets[0] : null,
    at,
  };

  const stamped = await renderSignal(data, template, true);
  const plain = await renderSignal(data, template, false);

  const body = await authReq<{ id: string; url: string }>("/api/shots/pnl", token, {
    method: "POST",
    body: JSON.stringify({
      image: toBlobUrl(stamped),
      raw: toBlobUrl(plain),
      symbol: trade.symbol,
      side,
      kind: "signal",
      note: `${side === "long" ? "LONG" : "SHORT"} ${trade.symbol} x${trade.leverage}`,
      // Куда странице ронять оттиск. Числами, а не именем бланка: держать те же
      // доли ещё и на сервере значит однажды их разойти.
      card: { variant: template.id, ink: template.accent, stamp: template.stamp },
    }),
  });
  return body ? `${API_URL}${body.url}` : null;
}

/** Выложить карточку результата - ту же, что делают в терминале. */
async function publishResult(trade: SharedTrade, at: string, owner: string): Promise<string | null> {
  const data = cardFromShared(trade, at, owner || undefined);
  const variant = defaultVariant(trade.side);
  const stamped = await render(data, variant, true);
  const plain = await render(data, variant, false);
  return publishCard(stamped, plain, data, variant);
}

/**
 * Собрать карточку сделки и выложить её.
 *
 * `owner` - имя на бланке итога. Пусто у того, кто ещё не назвался:
 * подписывать карточку чужим именем нельзя, а безымянная - обычное дело.
 */
export async function cardLink(trade: SharedTrade, owner: string): Promise<CardLink | null> {
  try {
    // Закрытую заверяет дата закрытия, ждущую и идущую - время разговора о
    // них: ставить на план дату, которой ещё не было, нельзя.
    const at = trade.closedAt ?? new Date().toISOString();
    const url =
      trade.state === "closed"
        ? await publishResult(trade, at, owner)
        : await publishSignal(trade, at);

    if (!url) return null;
    return { url, image: `${url}.png` };
  } catch {
    // Бланк не загрузился, холст не дали, сеть отвалилась - сообщение уйдёт
    // без карточки.
    return null;
  }
}
