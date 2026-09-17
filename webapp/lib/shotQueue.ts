"use client";

// Очередь снимков: картинка не пропадает, если сеть отвалилась.
//
// Снимок делается в момент события - взяли цель, закрылась сделка. Момент
// этот не повторится: цена ушла, и снять тот же экран через минуту уже
// нельзя. Поэтому картинка сначала ложится в браузер, и только потом уходит
// на сервер. Не ушла - лежит и ждёт сети, в том числе через перезагрузку
// страницы и закрытие вкладки.
//
// Хранилище - IndexedDB, а не localStorage: снимок весит сотни килобайт, а
// localStorage даёт на всё про всё около пяти мегабайт и падает молча, когда
// они кончаются.

const DB = "nmnh-shots";
const STORE = "queue";
const VERSION = 1;

/** Сколько снимков держим в очереди: дальше вытесняем самые старые. */
export const QUEUE_LIMIT = 50;

export interface QueuedShot {
  /** Номер записи: его назначает хранилище. */
  id?: number;
  clientId: string;
  image: string;
  note: string;
  stage: string;
  /** Когда снимок сделан - не когда отправлен. */
  at: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const ask = indexedDB.open(DB, VERSION);
    ask.onupgradeneeded = () => {
      const base = ask.result;
      if (!base.objectStoreNames.contains(STORE)) {
        base.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    ask.onsuccess = () => done(ask.result);
    ask.onerror = () => fail(ask.error);
  });
}

function wait<T>(ask: IDBRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    ask.onsuccess = () => done(ask.result);
    ask.onerror = () => fail(ask.error);
  });
}

/** Отложить снимок до лучшей сети. */
export async function keepShot(shot: Omit<QueuedShot, "id">): Promise<boolean> {
  try {
    const base = await open();
    const deal = base.transaction(STORE, "readwrite");
    const store = deal.objectStore(STORE);
    await wait(store.add(shot));

    // Очередь не резиновая: если сеть пропала надолго, старые снимки уступают
    // место новым. Свежий снимок ценнее позавчерашнего.
    const all = await wait(store.getAllKeys());
    for (const key of all.slice(0, Math.max(0, all.length - QUEUE_LIMIT))) {
      store.delete(key);
    }
    base.close();
    return true;
  } catch {
    // Приватное окно, запрет на хранилище, переполненный диск: снимок мы
    // потеряем, но терминал из-за этого падать не должен.
    return false;
  }
}

/** Что лежит в очереди, от старых к новым. */
export async function queuedShots(): Promise<QueuedShot[]> {
  try {
    const base = await open();
    const store = base.transaction(STORE, "readonly").objectStore(STORE);
    const all = await wait(store.getAll());
    base.close();
    return all as QueuedShot[];
  } catch {
    return [];
  }
}

/** Убрать отправленный снимок. */
export async function dropShot(id: number): Promise<void> {
  try {
    const base = await open();
    base.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    base.close();
  } catch {
    // Не убрался - попадётся при следующем разборе очереди и уйдёт ещё раз.
    // Двойной снимок в сделке неприятен, но терпим; потерянный - нет.
  }
}

/**
 * Отправить всё, что ждёт.
 *
 * `send` возвращает `true`, когда сервер принял снимок. Отказ по сути дела -
 * скажем, сделки уже нет - тоже считается доставкой: держать такой снимок в
 * очереди вечно бессмысленно, поэтому `send` сам решает, что с ним делать.
 */
export async function flushShots(
  send: (shot: QueuedShot) => Promise<boolean>,
): Promise<number> {
  const all = await queuedShots();
  let gone = 0;
  for (const shot of all) {
    if (shot.id === undefined) continue;
    let done = false;
    try {
      done = await send(shot);
    } catch {
      done = false;
    }
    if (!done) break; // Сеть всё ещё лежит: остальные ждут своей очереди.
    await dropShot(shot.id);
    gone += 1;
  }
  return gone;
}
