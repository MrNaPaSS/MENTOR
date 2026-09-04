"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { getAccessToken } from "./auth";

/** Не чаще одного запроса в этот интервал: фокус и навигация приходят пачками. */
const MIN_INTERVAL_MS = 5000;

/** Событие, которым страницы сообщают об изменении баланса внутри вкладки. */
export const COINS_EVENT = "nmnh-coins-updated";

/**
 * Баланс монет с обновлением при возвращении на вкладку и при переходах.
 *
 * Разовой загрузки при монтировании недостаточно: монеты начисляет ещё и
 * академия — бот дёргает платформу напрямую, мимо браузера, и никакого
 * события во вкладке не возникает. Человек зарабатывает монеты в мини-аппе
 * Telegram, переключается на сайт и видит старое число.
 *
 * @param key меняется при переходах — на смену перезапрашиваем баланс
 */
export function useCoins(key?: string) {
  const [coins, setCoins] = useState<number | null>(null);
  const lastFetch = useRef(0);

  const refresh = useCallback((force = false) => {
    const token = getAccessToken();
    if (!token) return;

    const now = Date.now();
    if (!force && now - lastFetch.current < MIN_INTERVAL_MS) return;
    lastFetch.current = now;

    api.coins(token)
      .then((c) => setCoins(c.balance))
      // Сеть моргнула — оставляем прежнее число, а не обнуляем витрину.
      .catch(() => setCoins((prev) => prev));
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
      const detail = (e as CustomEvent<{ balance?: number }>).detail;
      if (typeof detail?.balance === "number") setCoins(detail.balance);
      else refresh(true);
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

  return { coins, refresh };
}
