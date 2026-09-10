"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CoinTx } from "./api";
import { getAccessToken } from "./auth";

/** Не чаще одного запроса в этот интервал: фокус и навигация приходят пачками. */
const MIN_INTERVAL_MS = 5000;

/** Событие, которым страницы сообщают об изменении монет внутри вкладки. */
export const COINS_EVENT = "nmnh-coins-updated";

/**
 * Что можно сообщить событием. Баланс - после покупки, ожидание - после
 * получения наград. Пустое событие просит перечитать всё с сервера.
 */
export type CoinsEventDetail = {
  balance?: number;
  pending?: CoinTx[];
};

export type PendingSummary = {
  /** Сколько прибавится к балансу, если забрать всё: награды минус долги. */
  total: number;
  /** Сколько наград ждёт - число на значке в шапке. */
  count: number;
};

/**
 * Сводка ожидания.
 *
 * Считается так же, как на сервере (backend/coin_ledger.py): долг за убыток
 * наградой не считается, а одни долги без наград - это «забирать нечего», и
 * минус на значке не показывается.
 */
export function summarize(pending: readonly CoinTx[]): PendingSummary {
  const rewards = pending.filter((tx) => tx.amount > 0);
  if (rewards.length === 0) return { total: 0, count: 0 };
  return {
    total: pending.reduce((sum, tx) => sum + tx.amount, 0),
    count: rewards.length,
  };
}

type State = { coins: number | null; pending: CoinTx[] };

const NOTHING: CoinTx[] = [];

/**
 * Баланс монет и награды, ждущие получения.
 *
 * Разовой загрузки при монтировании недостаточно: монеты начисляет ещё и
 * академия — бот дёргает платформу напрямую, мимо браузера, и никакого
 * события во вкладке не возникает. Человек зарабатывает монеты в мини-аппе
 * Telegram, переключается на сайт и видит старое число.
 *
 * @param key меняется при переходах — на смену перезапрашиваем баланс
 * @param options.poll как часто спрашивать сервер, пока вкладка на экране, мс.
 *   Нужен одному месту - шапке: награда за сделку приходит сама, пока трейдер
 *   сидит в терминале, и узнать о ней можно, только спросив.
 */
export function useCoins(key?: string, options: { poll?: number } = {}) {
  const { poll } = options;
  const [state, setState] = useState<State>({ coins: null, pending: NOTHING });
  const lastFetch = useRef(0);

  const refresh = useCallback((force = false) => {
    const token = getAccessToken();
    if (!token) return;

    const now = Date.now();
    if (!force && now - lastFetch.current < MIN_INTERVAL_MS) return;
    lastFetch.current = now;

    api.coins(token)
      .then((c) => setState({ coins: c.balance, pending: c.pending ?? NOTHING }))
      // Сеть моргнула — оставляем прежнее число, а не обнуляем витрину.
      .catch(() => setState((prev) => prev));
  }, []);

  // Первая загрузка и обновление при переходах между разделами.
  useEffect(() => {
    refresh(true);
  }, [refresh, key]);

  useEffect(() => {
    // Возврат на вкладку — самый частый момент, когда баланс успел измениться
    // снаружи: человек уходил в Telegram проходить урок.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onEvent = (e: Event) => {
      const { balance, pending } = (e as CustomEvent<CoinsEventDetail>).detail ?? {};
      const hasBalance = typeof balance === "number";
      const hasPending = Array.isArray(pending);
      if (!hasBalance && !hasPending) {
        refresh(true);
        return;
      }
      setState((prev) => ({
        coins: hasBalance ? balance : prev.coins,
        pending: hasPending ? pending : prev.pending,
      }));
    };

    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(COINS_EVENT, onEvent);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(COINS_EVENT, onEvent);
    };
  }, [refresh]);

  // Опрос - только пока вкладку видно: свёрнутой некому показывать значок.
  useEffect(() => {
    if (!poll) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, poll);
    return () => window.clearInterval(timer);
  }, [poll, refresh]);

  const { total, count } = summarize(state.pending);
  return {
    coins: state.coins,
    pending: state.pending,
    pendingTotal: total,
    pendingCount: count,
    refresh,
  };
}
