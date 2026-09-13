"use client";

// Какая биржа сейчас на экране: журнал, аналитика и календарь смотрят на одну.
//
// Суммы разных бирж не складываются в одной строке отчёта, поэтому «все сразу»
// здесь нет: экран всегда показывает один счёт. История при этом остаётся вся -
// сделки принадлежат ученику, а не бирже, - и переключатель даёт дойти до
// любой, включая ту, которой ученик больше не пользуется.
//
// Выбор общий для всех трёх экранов и переживает перезагрузку: ученик,
// торгующий на OKX, не должен переставлять биржу в каждом разделе заново.

import { useCallback, useEffect, useMemo, useState } from "react";

import { NO_VENUE } from "./journal";

/** Где помнится выбор. Один ключ на все разделы: биржа у ученика одна и та же. */
const KEY = "nmnh.journal.venue";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Хранилище закрыто настройками браузера: просто откроемся на активной.
    return null;
  }
}

function write(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Не сохранилось - раздел работает и без памяти о выборе.
  }
}

/**
 * Какая биржа показывается из тех, что есть.
 *
 * Порядок решения: что выбрал ученик, иначе биржа, на которую уходят новые
 * сделки, иначе первая из списка - там она стоит по числу сделок. Выбор,
 * которого в списке нет (счёт отключили, сделок за период не осталось), молча
 * уступает место активной: пустой экран с выбранной вручную биржей выглядит
 * поломкой, а не фильтром.
 *
 * Пусто - выбирать не из чего: биржа одна или сделок нет вовсе, и фильтр в
 * запросе тогда лишний.
 */
export function chooseVenue(
  available: readonly string[],
  chosen: string | null,
  active?: string,
): string {
  if (available.length < 2) return "";
  if (chosen && available.includes(chosen)) return chosen;
  if (active && available.includes(active)) return active;
  return available[0];
}

/**
 * Подпись биржи на кнопке: код, а не «OKX Futures».
 *
 * Строка разреза узкая, а различает биржи ровно первое слово. Сделки без биржи
 * - торговля по стакану, без счёта: у них своя подпись, иначе они молча
 * приписались бы соседней бирже.
 */
export function venueLabel(code: string, none: string): string {
  return code === NO_VENUE ? none : code.toUpperCase();
}

export type VenuePick = {
  /**
   * Биржа экрана. Пусто - выбирать не из чего: биржа одна или сделок нет
   * вовсе, и фильтр в запросе тогда лишний.
   */
  venue: string;
  /** Нажали на биржу в переключателе. */
  pick: (code: string) => void;
  /** Есть ли из чего выбирать: переключатель рисуется только тогда. */
  many: boolean;
};

/** Выбранная биржа из тех, что встречаются в сделках, с памятью о выборе. */
export function useVenuePick(available: readonly string[], active?: string): VenuePick {
  const [chosen, setChosen] = useState<string | null>(null);

  // Хранилище читаем после отрисовки: на сервере страницы его нет, и разметка
  // разошлась бы с первой перерисовкой в браузере.
  useEffect(() => {
    setChosen(read());
  }, []);

  // Список приходит новым массивом на каждый ответ сервера: сравниваем по
  // содержимому, иначе биржа пересчитывалась бы на ровном месте.
  const key = available.join(",");

  const venue = useMemo(
    () => chooseVenue(key ? key.split(",") : [], chosen, active),
    [key, chosen, active],
  );

  const pick = useCallback((code: string) => {
    setChosen(code);
    write(code);
  }, []);

  return { venue, pick, many: available.length > 1 };
}
