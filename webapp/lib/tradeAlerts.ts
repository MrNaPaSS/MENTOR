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

import { dict } from "@/lib/i18n";
import type { Toast } from "@/components/scalping/Toasts";
import { readTrades, writeTrades } from "@/lib/tradeStore";
import { liveTrades, openSizes, tradingStatus } from "@/lib/trading";
import { play } from "@/lib/sound";
import { closeOnExchange, riskFree, type ActiveTrade } from "@/lib/trade/position";
import { noteMiss, shouldBury, type Miss } from "@/lib/trade/missing";

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

/**
 * Убрать всё, что было сказано об этой сделке.
 *
 * Сделка закрылась - и «взята цель 3», висящее рядом с сообщением о стопе,
 * читается как два разных исхода одной сделки. Опознаватели всех её
 * уведомлений начинаются с её же идентификатора, поэтому снимаются разом.
 */
export function dismissTrade(tradeId: string): void {
  emit(toasts.filter((one) => !one.id.startsWith(`${tradeId}:`)));
}

/**
 * Сообщить о закрытии сделки. Одна строка на сделку, кто бы её ни поднял.
 *
 * Всё, что говорилось по дороге, снимается: «взята цель» рядом с сообщением о
 * стопе читается как два разных исхода одной сделки. В заголовке - факт, под
 * ним - чем кончилось и на сколько.
 *
 * Одна функция на терминал и на оболочку кабинета: две копии текста уже
 * расходились, и одна из них называла закрытие на бирже ручным.
 */
export function announceClose(row: ActiveTrade): void {
  const t = dict().terminal.events;
  const coin = row.symbol.replace(/USDT$/, "");
  dismissTrade(row.id);

  // Стоп после снятого риска - это не убыток, и называть его так же, как
  // выбитую сделку, значит пугать зря. Закрытие на бирже без понятной
  // причины - «позиция закрыта»: руками её, может, никто и не трогал.
  const done =
    row.outcome === "take"
      ? { sound: "profit" as const, note: t.worked, tone: "up" as const }
      : row.outcome === "stop"
        ? riskFree(row)
          ? { sound: "close" as const, note: t.stoppedEven, tone: "plain" as const }
          : { sound: "stop" as const, note: t.stopped, tone: "down" as const }
        : {
            sound: "close" as const,
            note: row.onExchange ? t.closed : t.closedByHand,
            tone: "plain" as const,
          };
  play(done.sound);
  pushToast({
    id: `${row.id}:out`,
    symbol: row.symbol,
    title: t.closedTitle(coin),
    text: `${done.note} · ${row.pnl >= 0 ? "+" : "-"}${Math.abs(row.pnl).toFixed(2)} $`,
    tone: done.tone,
  });
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
 * Пустота по каждой открытой сделке: с какого круга биржа её не показывает.
 *
 * Раньше «сделка закрыта» поднималось по первому же пустому ответу. Биржа
 * отвечает пустым и на своей заминке - трейдер переходил в терминал, а там
 * висело «закрыта» рядом с живой позицией на графике.
 */
const misses = new Map<string, Miss>();

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

    await settle(mine, sizes);
    if (!was || stopped) return;

    for (const trade of mine) {
      const key = `${trade.symbol}:${trade.side}`;
      const had = was[key] ?? 0;
      const now = sizes[key] ?? 0;
      const coin = trade.symbol.replace(/USDT$/, "");
      const t = dict().terminal.events;
      const side = trade.side === "long" ? t.long : t.short;

      // Позиции не было - стала: лимитка исполнилась.
      if (trade.status === "planned" && had <= 0 && now > 0) {
        play("entry");
        pushToast({
          id: `${trade.id}:in`,
          symbol: trade.symbol,
          title: t.entered(coin),
          text: t.openTerminal(side),
          tone: trade.side === "long" ? "up" : "down",
        });
        continue;
      }

    }
  }

  /**
   * Закрытые сделки: сообщить и убрать из хранилища.
   *
   * Не по первому пустому ответу, а так же, как в терминале: пустота держится
   * и сопровождение на сервере сделку больше не ведёт. Тогда у сервера уже
   * лежит итог по исполнениям, и уведомление говорит, чем кончилось и на
   * сколько.
   *
   * Сделка уходит из хранилища здесь же. Иначе, вернувшись в терминал,
   * трейдер получал о ней второе уведомление - терминал хоронил её заново.
   */
  async function settle(mine: ActiveTrade[], sizes: Record<string, number>) {
    const missed = mine.filter(
      (t) => t.status === "open" && !((sizes[`${t.symbol}:${t.side}`] ?? 0) > 0),
    );
    for (const t of mine) {
      if (!missed.includes(t)) misses.delete(t.id);
    }
    if (missed.length === 0) return;

    const mind = await liveTrades().catch(() => null);
    if (stopped || terminalOpen()) return;
    const served = mind ? new Set(mind.trades.map((one) => one.client_id)) : null;
    const booked = new Map((mind?.closed ?? []).map((one) => [one.client_id, one]));

    const now = Date.now();
    const gone = new Set<string>();
    for (const trade of missed) {
      const miss = noteMiss(misses.get(trade.id), now);
      misses.set(trade.id, miss);
      if (!shouldBury(miss, now, served ? served.has(trade.id) : null)) continue;
      misses.delete(trade.id);
      gone.add(trade.id);

      const said = booked.get(trade.id);
      announceClose(
        closeOnExchange(
          trade,
          0,
          now,
          said ? { exit: said.exit_price, pnl: said.pnl, fee: said.fee } : null,
        ),
      );
    }
    if (gone.size > 0) writeTrades(readTrades().filter((t) => !gone.has(t.id)));
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
    misses.clear();
  };
}
