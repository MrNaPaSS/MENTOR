"use client";

// Общая память панелей: переход между разделами перестаёт быть перезагрузкой.
//
// Раньше каждая панель спрашивала своё при появлении, и возврат на «Рынок»
// означал девять скелетов вместо цифр - при том, что минуту назад те же цифры
// на экране были. Теперь панель получает последнее известное **сразу**, а
// свежее догоняет и перерисовывает её.
//
// Приём тот же, что на сервере ([backend/sources/cache.py](../../backend/sources/cache.py)):
// значение и его возраст, живое в пределах срока, устаревшее - с пометкой.
// Разница одна: здесь всё живёт в памяти вкладки и умирает вместе с ней.
// В хранилище класть нельзя - это тот же чужой экран, только надолго.
//
// Здесь только рыночные панели: их цифры одинаковы для всех, и показать
// вчерашнюю капитализацию не страшно. Деньги ученика - позиции, баланс,
// журнал - через этот кэш не ходят: там старое число хуже пустого.

import { useCallback, useEffect, useRef, useState } from "react";

interface Entry<T> {
  value: T;
  /** Когда положили, миллисекунды. */
  at: number;
}

const store = new Map<string, Entry<unknown>>();
/** Запросы в полёте: две панели на одном ключе не идут за одним и тем же дважды. */
const flying = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();

/** Последнее известное значение и его возраст. `null` - не спрашивали ещё. */
export function peek<T>(key: string): Entry<T> | null {
  return (store.get(key) as Entry<T> | undefined) ?? null;
}

export function put<T>(key: string, value: T): void {
  store.set(key, { value, at: Date.now() });
  listeners.get(key)?.forEach((fn) => fn());
}

/** Забыть всё. На смену ученика за тем же экраном. */
export function dropAll(): void {
  store.clear();
  flying.clear();
  listeners.forEach((set) => set.forEach((fn) => fn()));
}

function subscribe(key: string, fn: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(fn);
  listeners.set(key, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Спросить источник, если пора, и положить ответ.
 *
 * Пока запрос в полёте, второй за тем же ключом не отправляется: на «Рынке»
 * тепловая карта и бегущая строка живут на одних тикерах, и два одинаковых
 * запроса при каждом появлении - это ровно вдвое больше, чем нужно.
 */
export async function refresh<T>(
  key: string,
  loader: () => Promise<T>,
  ttl: number,
): Promise<T | null> {
  const known = peek<T>(key);
  if (known && Date.now() - known.at < ttl) return known.value;

  const inFlight = flying.get(key) as Promise<T> | undefined;
  if (inFlight) return inFlight;

  const promise = loader()
    .then((value) => {
      put(key, value);
      return value;
    })
    .catch((err) => {
      // Последнее известное остаётся: панель покажет его, а не пустоту.
      throw err;
    })
    .finally(() => {
      flying.delete(key);
    });

  flying.set(key, promise as Promise<unknown>);
  return promise;
}

export interface CachedState<T> {
  /** Последнее известное значение. `null` - показывать пока нечего. */
  data: T | null;
  /** Первое появление: значения нет и запрос ещё идёт. */
  loading: boolean;
  /** Источник не ответил, и показать тоже нечего. */
  failed: boolean;
  /** Возраст показанного значения в миллисекундах. */
  age: number;
  /** Спросить источник прямо сейчас, не дожидаясь срока. */
  reload: () => void;
}

export interface CachedOptions {
  /** Сколько значение считается свежим. */
  ttl: number;
  /** Как часто обновлять, пока панель на экране. По умолчанию - как ttl. */
  refreshMs?: number;
  /** Не спрашивать вовсе: панель скрыта или ещё не нужна. */
  enabled?: boolean;
}

/**
 * Значение панели из общей памяти.
 *
 * При появлении отдаёт последнее известное сразу, поэтому скелет виден только
 * в первый раз за сеанс.
 */
export function useCached<T>(
  key: string,
  loader: () => Promise<T>,
  { ttl, refreshMs, enabled = true }: CachedOptions,
): CachedState<T> {
  const known = peek<T>(key);
  const [entry, setEntry] = useState<Entry<T> | null>(known);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(!known);
  const load = useRef(loader);
  load.current = loader;

  const ask = useCallback(
    (force: boolean) => {
      if (!enabled) return;
      setPending(!peek<T>(key));
      refresh(key, () => load.current(), force ? 0 : ttl)
        .then(() => setFailed(false))
        .catch(() => setFailed(true))
        .finally(() => setPending(false));
    },
    [key, ttl, enabled],
  );

  useEffect(() => {
    const read = () => setEntry(peek<T>(key));
    read();
    const stop = subscribe(key, read);
    ask(false);

    const every = refreshMs ?? ttl;
    const timer = every > 0 && enabled ? setInterval(() => ask(true), every) : null;
    return () => {
      stop();
      if (timer) clearInterval(timer);
    };
  }, [key, ask, refreshMs, ttl, enabled]);

  return {
    data: entry?.value ?? null,
    loading: pending && !entry,
    failed: failed && !entry,
    age: entry ? Date.now() - entry.at : 0,
    reload: () => ask(true),
  };
}
