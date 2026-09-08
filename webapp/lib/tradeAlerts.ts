"use client";

// Уведомления терминала, живущие вне терминала.
//
// Сделка идёт на бирже, а не на экране: лимитка исполняется и цель берётся, пока
// трейдер смотрит анализы, читает новости или выбирает награду в маркете. Раньше
// об этом сообщал только сам терминал - уйдя с него, трейдер узнавал о входе,
// когда возвращался. Здесь то же наблюдение, но привязанное к кабинету целиком.
//
// Кто наблюдает - решается на ходу. Терминал ведёт своё наблюдение и знает
// больше: у него на руках живые сделки, стакан и разметка. Пока он открыт,
// оболочка стоит в стороне, чтобы одно событие не пришло дважды. Стоило ему
// закрыться - наблюдение подхватывает оболочка.
//
// Склад уведомлений при этом общий. Он снаружи от React намеренно: список
// переживает переход между разделами, и уведомление, поднятое в терминале,
// не пропадает от того, что трейдер ушёл в аналитику.

import type { Toast } from "@/components/scalping/Toasts";
import { readTrades } from "@/lib/tradeStore";
import { openSizes, tradingStatus } from "@/lib/trading";
import { play } from "@/lib/sound";

/** Как часто спрашиваем биржу об открытых объёмах. */
const POLL_MS = 5000;

/** Сколько уведомлений держим разом: выше этого старые уходят сами. */
const KEEP = 4;

let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit(next: Toast[]): void {
  toasts = next;
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function snapshot(): Toast[] {
  return toasts;
}

/** На сервере уведомлений нет: снимок постоянный, иначе React уходит в цикл. */
const SERVER: Toast[] = [];

export function serverSnapshot(): Toast[] {
  return SERVER;
}

/**
 * Поднять уведомление, если такого ещё нет.
 *
 * Одно и то же событие видят двое - опрос объёмов и наблюдение за состоянием
 * сделки, - поэтому опознаватель у события общий, и второй заметивший ничего
 * не добавляет.
 */
export function pushToast(toast: Toast): void {
  if (toasts.some((one) => one.id === toast.id)) return;
  // Больше горсти уведомлений разом - это уже стена поверх графика.
  emit([...toasts, toast].slice(-KEEP));
}

export function dismissToast(id: string): void {
  emit(toasts.filter((one) => one.id !== id));
}

/** Убрать всё по этой монете: её уже открыли, сообщать больше не о чем. */
export function dismissSymbol(symbol: string): void {
  emit(toasts.filter((one) => one.symbol !== symbol));
}

// ── Кто наблюдает ──────────────────────────────────────────────────────────

let terminals = 0;

/**
 * Терминал открыт: оболочке наблюдать не нужно.
 *
 * Счётчиком, а не флагом: при переходе между разделами новая страница успевает
 * появиться раньше, чем уходит старая, и флаг на этом мгновении сбрасывался бы
 * в «закрыт», хотя терминал на экране.
 */
export function holdTerminal(): () => void {
  terminals += 1;
  return () => {
    terminals = Math.max(0, terminals - 1);
  };
}

export function terminalOpen(): boolean {
  return terminals > 0;
}

// ── Наблюдение ─────────────────────────────────────────────────────────────

/** Объёмы прошлого круга: без «до» переход не отличить от стоящей позиции. */
let before: Record<string, number> | null = null;

/**
 * Следить за сделками из любого раздела кабинета.
 *
 * Возвращает остановку. Наблюдение молчит, пока открыт терминал, - там оно
 * своё, и там оно знает больше.
 */
export function watchTrades(): () => void {
  let stopped = false;

  async function look() {
    if (stopped || terminalOpen()) {
      // Терминал ведёт учёт сам. Забываем прошлый круг: вернувшись к
      // наблюдению, начнём с чистого листа, иначе первое же событие сравнится
      // с объёмами получасовой давности.
      before = null;
      return;
    }

    const mine = readTrades().filter((t) => t.status !== "closed");
    if (mine.length === 0) {
      before = null;
      return;
    }

    // Вкладка свёрнута - биржу не тревожим. Событие никуда не денется: оно
    // сравнится с объёмами при следующем взгляде на экран.
    if (typeof document !== "undefined" && document.hidden) return;

    const sizes = await openSizes().catch(() => null);
    if (stopped || !sizes) return;

    const was = before;
    before = sizes;
    if (!was) return;

    for (const trade of mine) {
      const key = `${trade.symbol}:${trade.side}`;
      const had = was[key] ?? 0;
      const now = sizes[key] ?? 0;
      const coin = trade.symbol.replace(/USDT$/, "");
      const side = trade.side === "long" ? "лонг" : "шорт";

      // Позиции не было - стала: лимитка исполнилась.
      if (trade.status === "planned" && had <= 0 && now > 0) {
        play("entry");
        pushToast({
          id: `${trade.id}:in`,
          symbol: trade.symbol,
          title: `${coin} - вход состоялся`,
          text: `${side} · открыть терминал`,
          tone: trade.side === "long" ? "up" : "down",
        });
        continue;
      }

      // Была - не стало: сделка закрылась. Чем именно, скажет журнал, а знать
      // о самом событии трейдер должен сразу, в каком бы разделе ни был.
      if (trade.status === "open" && had > 0 && now <= 0) {
        play("order");
        pushToast({
          id: `${trade.id}:out`,
          symbol: trade.symbol,
          title: `${coin} - позиция закрыта`,
          text: `${side} · итог в журнале`,
          tone: "plain",
        });
      }
    }
  }

  // Наблюдаем только при подключённом счёте: без ключей биржа не ответит, и
  // круг за кругом уходил бы впустую.
  let timer: number | null = null;
  tradingStatus()
    .then((status) => {
      if (stopped || !status?.connected) return;
      void look();
      timer = window.setInterval(look, POLL_MS);
    })
    .catch(() => {
      // Состояние счёта не узнали - молчим. Терминал спросит своё сам.
    });

  return () => {
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
    before = null;
  };
}
