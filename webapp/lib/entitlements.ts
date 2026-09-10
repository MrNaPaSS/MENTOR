"use client";

// Функции платформы, купленные за монеты.
//
// Нужны не только маркету: кнопка выгрузки в журнале терминала должна знать,
// куплена ли выгрузка. Список один на вкладку и перечитывается по событию -
// маркет объявляет покупку, журнал узнаёт о ней без перезагрузки.

import { useCallback, useEffect, useState } from "react";
import { api, type Entitlement } from "./api";
import { getAccessToken } from "./auth";

/** Событие: список купленных функций изменился. */
export const ENTITLEMENTS_EVENT = "nmnh-entitlements-updated";

export function announceEntitlements(): void {
  window.dispatchEvent(new Event(ENTITLEMENTS_EVENT));
}

const NOTHING: Entitlement[] = [];

export function useEntitlements() {
  const [list, setList] = useState<Entitlement[]>(NOTHING);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    const token = getAccessToken();
    if (!token) {
      setLoaded(true);
      return;
    }
    api
      .shopEntitlements(token)
      .then((rows) => setList(rows ?? NOTHING))
      // Не ответил сервер - считаем, что ничего не куплено: лишняя кнопка
      // «купить» лучше, чем кнопка функции, которая откажет.
      .catch(() => setList(NOTHING))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(ENTITLEMENTS_EVENT, refresh);
    return () => window.removeEventListener(ENTITLEMENTS_EVENT, refresh);
  }, [refresh]);

  const has = useCallback((feature: string) => list.some((e) => e.feature === feature), [list]);
  const find = useCallback((feature: string) => list.find((e) => e.feature === feature) ?? null, [list]);

  return { list, loaded, has, find, refresh };
}
