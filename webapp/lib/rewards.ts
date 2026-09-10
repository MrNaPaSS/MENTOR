"use client";

// Награды в кабинете: когда о них сказать и как открыть окно получения.
//
// Награда за сделку приходит сама, пока трейдер смотрит в стакан, - и молча
// лечь в ожидание ей мало: о ней нужно сказать там, где человек сейчас. Для
// этого есть общий склад уведомлений терминала (tradeAlerts): уведомление,
// поднятое здесь, видно и над графиком, и под шапкой любого раздела.
//
// Каждую награду объявляем один раз. Что уже объявлено, помнит сессия
// вкладки: иначе каждый переход между разделами заново сообщал бы о тех же
// трёх наградах, которые человек пока не забрал.

import { useEffect, useRef } from "react";
import type { CoinTx } from "./api";
import { dict, intlLocale } from "./i18n";
import { rewardLabel } from "./rewardLabel";
import { dismissTrade, pushToast } from "./tradeAlerts";
import { play } from "./sound";

/** Событие, которым уведомление просит шапку открыть окно наград. */
export const REWARDS_OPEN_EVENT = "nmnh-rewards-open";

export function openRewards(): void {
  window.dispatchEvent(new Event(REWARDS_OPEN_EVENT));
}

/** Опознаватели уведомлений о наградах начинаются с этого звена. */
const TOAST_GROUP = "reward";

/** Награды забраны - уведомления о них больше не к месту. */
export function dismissRewardToasts(): void {
  // Склад снимает группу по началу опознавателя: `reward:<id>`.
  dismissTrade(TOAST_GROUP);
}

const SEEN_KEY = "nmnh-rewards-seen";
/** Сколько опознавателей помним. Больше ожидающих наград разом не бывает. */
const SEEN_LIMIT = 300;

function readSeen(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((v): v is number => typeof v === "number") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: number[]): void {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_LIMIT)));
  } catch {
    // Хранилище закрыто (приватный режим) - объявим ещё раз, не страшно.
  }
}

/**
 * Сказать о новых наградах.
 *
 * Одна новая - уведомление с её названием и суммой. Несколько разом (первый
 * заход за день, пачка достижений) - одно общее, а не стена из плашек.
 * Звук - только для пришедших при открытой вкладке: на входе он прозвучал бы
 * в ответ ни на что.
 */
export function useRewardNotices(pending: readonly CoinTx[], loaded: boolean): void {
  const first = useRef(true);

  useEffect(() => {
    if (!loaded) return;
    const wasFirst = first.current;
    first.current = false;

    const seen = readSeen();
    const fresh = pending.filter((tx) => tx.amount > 0 && !seen.has(tx.id));
    if (fresh.length === 0) return;
    writeSeen([...Array.from(seen), ...fresh.map((tx) => tx.id)]);

    const t = dict();
    const format = (n: number) => n.toLocaleString(intlLocale());

    if (fresh.length === 1) {
      const tx = fresh[0];
      pushToast({
        id: `${TOAST_GROUP}:${tx.id}`,
        title: t.rewards.toastOneTitle(format(tx.amount)),
        text: t.rewards.toastOneText(rewardLabel(tx, t)),
        tone: "gold",
        action: openRewards,
      });
    } else {
      const amount = fresh.reduce((sum, tx) => sum + tx.amount, 0);
      pushToast({
        id: `${TOAST_GROUP}:batch:${fresh[0].id}`,
        title: t.rewards.toastManyTitle(fresh.length),
        text: t.rewards.toastManyText(format(amount)),
        tone: "gold",
        action: openRewards,
      });
    }

    if (!wasFirst) play("reward");
  }, [pending, loaded]);
}
