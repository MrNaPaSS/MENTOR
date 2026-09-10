"use client";

// Лента общего чата - на складе снаружи от React.
//
// Так же, как уведомления о сделках. Причин две, и обе не про удобство.
//
// Первая: писать в чат умеет не только он сам. Сделкой делятся из журнала,
// снимком графика - из панели инструментов, и держать ленту внутри компонента
// значило бы, что свернул панель - потерял разговор.
//
// Вторая: непрочитанные. Точка у свёрнутой панели должна загораться и тогда,
// когда самой панели на экране нет, - значит соединение живёт снаружи неё.
//
// Сообщения хранит сервер, здесь только их копия и живой канал: историю
// спрашиваем страницами, новое приезжает сокетом.

import { API_URL, liveAccessToken } from "@/lib/api";

import { cardLink } from "./card";
import {
  edit as editMessage,
  history,
  normalize,
  remove as removeMessage,
  send as sendMessage,
  threads as loadThreads,
  type ChatAttach,
  type ChatAuthor,
  type ChatMessage,
  type ChatThread,
  type SendExtras,
} from "./api";

export type { ChatAttach, ChatAuthor, ChatMessage, ChatQuote, ChatThread, SharedTrade } from "./api";
export type { SendExtras } from "./api";

export type ChatState = {
  messages: ChatMessage[];
  /** Кто сейчас в комнате. Приходит от сервера, а не считается по ленте. */
  people: ChatAuthor[];
  /**
   * Сколько человек в форумной группе Telegram.
   *
   * Не «онлайн»: кто из них сейчас смотрит в экран, Telegram не показывает
   * никому. Это участники форума - тот же разговор, только на другой его
   * стороне, где людей всегда больше, чем во вкладке на сайте.
   */
  forum: number;
  /** Кто мы: по нему сообщение узнаёт себя и прижимается вправо. */
  me: ChatAuthor | null;
  /** Есть ли ещё история выше загруженного. */
  more: boolean;
  /** Непрочитанные: считаются, пока панель закрыта. */
  unread: number;
  /**
   * Непрочитанные по веткам: сколько пришло в каждую.
   *
   * Общее число говорит, что разговор идёт, но не говорит где, а веток у нас
   * четыре: человек открывал панель, видел точку и не находил, что изменилось,
   * - новое лежало в соседней вкладке. Метка на самой вкладке отвечает на это
   * сразу.
   */
  unreadByThread: Record<number, number>;
  /** Живой канал открыт. Нет - лента остаётся, но новое не приедет. */
  live: boolean;
  /** Ветки разговора: те же, что темы форума. */
  threads: ChatThread[];
  /** Открытая ветка. Ноль - веток ещё не привезли. */
  thread: number;
};

const EMPTY: ChatState = {
  messages: [],
  people: [],
  forum: 0,
  me: null,
  more: false,
  unread: 0,
  unreadByThread: {},
  live: false,
  threads: [],
  thread: 0,
};

let state: ChatState = EMPTY;
const listeners = new Set<() => void>();

/**
 * Лента каждой ветки, уже привезённая с сервера.
 *
 * Без неё переключение ветки очищало ленту и ждало ответа: запрос идёт через
 * туннель, и каждое переключение было пустой панелью на полсекунды и дольше.
 * Теперь ветка открывается сразу тем, что уже видели, а свежее догружается
 * следом.
 */
type Page = { messages: ChatMessage[]; more: boolean };
const cache = new Map<number, Page>();

/** Под этим ключом браузер помнит последнюю открытую ветку. */
const THREAD_KEY = "nmnh.chat.thread";

function rememberedThread(): number {
  try {
    return Number(localStorage.getItem(THREAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function rememberThread(thread: number): void {
  try {
    localStorage.setItem(THREAD_KEY, String(thread));
  } catch {
    // Хранилище закрыто - в следующий раз начнём с ветки по умолчанию.
  }
}

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  // Открытая ветка и её копия в кэше - одно и то же: что бы ни поменялось в
  // ленте, при возвращении в ветку оно должно быть на месте.
  if (state.thread && ("messages" in patch || "more" in patch)) {
    cache.set(state.thread, { messages: state.messages, more: state.more });
  }
  for (const fn of listeners) fn();
}

/** Лента ветки из кэша, а если её ещё не привозили - пустая. */
function cached(thread: number): Page {
  return cache.get(thread) ?? { messages: [], more: false };
}

/** Поправить неоткрытые ветки в кэше: правка и удаление приходят без ветки. */
function patchCached(fn: (list: ChatMessage[]) => ChatMessage[]): void {
  for (const [thread, page] of cache) {
    if (thread !== state.thread) cache.set(thread, { ...page, messages: fn(page.messages) });
  }
}

/**
 * Свежая страница поверх того, что уже было.
 *
 * Сервер отдаёт последние полсотни, а в ленте их может быть больше: трейдер
 * листал вверх. Старое выше свежей страницы остаётся, как и пришедшее сокетом
 * после неё, - иначе возвращение в ветку обрезало бы прочитанное и прыгало.
 */
function merge(kept: Page, fresh: Page): Page {
  if (fresh.messages.length === 0) return kept.messages.length ? kept : fresh;
  const first = fresh.messages[0].id;
  const last = fresh.messages[fresh.messages.length - 1].id;
  const above = kept.messages.filter((m) => m.id < first);
  const below = kept.messages.filter((m) => m.id > last);
  return {
    messages: [...above, ...fresh.messages, ...below],
    more: above.length > 0 ? kept.more : fresh.more,
  };
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function snapshot(): ChatState {
  return state;
}

/** На сервере ленты нет: разметка страницы не должна расходиться с браузером. */
export function serverSnapshot(): ChatState {
  return EMPTY;
}

// ── Живой канал ──
//
// Соединение одно на вкладку, сколько бы мест его ни просило: панель терминала,
// страница чата, сам терминал ради точки непрочитанного. Считаем просящих.
//
// Просящие двух родов. Одни читают ленту - им нужна история и ветки. Другие
// только присутствуют: оболочка кабинета держит соединение на любой странице,
// потому что «в сети» - это про человека на сайте, а не про человека в
// терминале. Раньше присутствие открывалось вместе с чатом, и ушедший в
// анализы или в маркет пропадал из комнаты, продолжая сидеть на сайте.

let socket: WebSocket | null = null;
/** Сколько мест держат соединение: и читающие, и просто присутствующие. */
let users = 0;
/** Сколько мест читают ленту. По первому из них тянется история. */
let readers = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
// Растущая пауза перед повтором: сеть падает не на секунду, и долбить сервер
// каждые полсекунды - верный способ не пустить обратно и тех, кто дождался.
let wait = 1000;
/** Панель открыта и её видно: пришедшее считается прочитанным сразу. */
let reading = false;

/** Идёт подключение: токен обновляется, сокета ещё нет. */
let dialing = false;

function connect() {
  if (socket || dialing || users === 0) return;
  dialing = true;
  // Токен - живой, а не тот, что лежит в хранилище. Он живёт четверть часа, а
  // сокет переподключается сам, без запроса, который обновил бы его на отказе:
  // ученик с истёкшим токеном стучался в чат с ним же и получал 403, пока не
  // перезагрузил страницу.
  void liveAccessToken()
    .catch(() => null)
    .then((token) => {
      dialing = false;
      if (token) dial(token);
    });
}

function dial(token: string) {
  if (socket || users === 0) return;

  const base = API_URL.replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/ws/chat?token=${encodeURIComponent(token)}`);
  socket = ws;

  ws.onopen = () => {
    wait = 1000;
    set({ live: true });
  };

  ws.onmessage = (event) => {
    let frame: { event: string; payload: Record<string, unknown> };
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }

    if (frame.event === "hello") {
      const you = frame.payload.you as ChatAuthor | undefined;
      const people = (frame.payload.people ?? []) as ChatAuthor[];
      set({
        me: you ? host(you) : null,
        people: people.map(host),
        forum: Number(frame.payload.forum ?? 0) || 0,
      });
      return;
    }
    if (frame.event === "people") {
      set({
        people: ((frame.payload.people ?? []) as ChatAuthor[]).map(host),
        forum: Number(frame.payload.forum ?? 0) || 0,
      });
      return;
    }
    if (frame.event === "edited") {
      const edited = normalize(frame.payload as never);
      patchCached((list) => list.map((m) => (m.id === edited.id ? edited : m)));
      set({ messages: state.messages.map((m) => (m.id === edited.id ? edited : m)) });
      return;
    }
    if (frame.event === "removed") {
      const id = Number(frame.payload.id);
      patchCached((list) => list.filter((m) => m.id !== id));
      set({ messages: state.messages.filter((m) => m.id !== id) });
      return;
    }
    if (frame.event === "message") {
      const message = normalize(frame.payload as never);
      // Своё сообщение уже лежит в ленте: его положил ответ на отправку.
      if (state.messages.some((m) => m.id === message.id)) return;

      // Сокет приносит все ветки сразу - комната одна. В ленту кладём только
      // открытую: подмешать чужую значит показать разговор, которого на этой
      // вкладке не начинали. Но счётчик непрочитанного растёт от любой - иначе
      // сообщение в соседней ветке останется незамеченным навсегда.
      const mine = !state.thread || (message.threadId ?? 0) === state.thread;
      // Сообщение соседней ветки ложится в её кэш: открыв её, трейдер увидит
      // его сразу, а не после ответа сервера.
      if (!mine) {
        const at = message.threadId ?? 0;
        const page = cache.get(at);
        if (page && !page.messages.some((m) => m.id === message.id)) {
          cache.set(at, { ...page, messages: [...page.messages, message] });
        }
      }
      // Открытая ветка при открытой панели прочитана сразу - её и не считаем.
      // Всё остальное копится по своей ветке: и то, что пришло в соседнюю,
      // пока трейдер читал эту, и то, что пришло, пока панель была свёрнута.
      if (reading && mine) {
        set({ messages: [...state.messages, message] });
        return;
      }
      const at = (message.threadId ?? 0) || state.thread;
      const counts = { ...state.unreadByThread, [at]: (state.unreadByThread[at] ?? 0) + 1 };
      set({
        messages: mine ? [...state.messages, message] : state.messages,
        unreadByThread: counts,
        unread: total(counts),
      });
    }
  };

  const down = () => {
    if (socket !== ws) return;
    socket = null;
    set({ live: false });
    if (users === 0) return;
    retry = setTimeout(connect, wait);
    wait = Math.min(wait * 2, 30000);
  };

  ws.onclose = down;
  ws.onerror = down;
}

function host(author: ChatAuthor): ChatAuthor {
  return { ...author, avatar: author.avatar ? `${API_URL}${author.avatar}` : "" };
}

/**
 * Подключиться к чату. Возвращает отписку.
 *
 * Первый просящий тянет историю и открывает сокет, последний уходящий его
 * закрывает. Терминал держит подключение всё время, пока открыт: иначе точка
 * непрочитанного загоралась бы только у того, кто и так смотрит в чат.
 */
export function open(): () => void {
  const leave = attend();
  readers += 1;
  if (readers === 1) {
    // Ветку, открытую в прошлый раз, просим сразу - вместе со списком веток, а
    // не после него. Раньше до первого сообщения шло два запроса подряд, а
    // между ними мелькала общая лента без веток, которую тут же выбрасывали.
    const early = state.thread || rememberedThread();
    if (early) {
      if (!state.thread) set({ thread: early, ...cached(early) });
      void reload(early);
    }
    // Ветки тянем один раз вместе с историей: переключатель обязан появиться
    // сразу, а не после первого сообщения.
    void loadThreads().then((rows) => {
      if (rows.length === 0) {
        // Веток нет - чат остаётся общей лентой, как до них.
        if (state.thread) set({ thread: 0, messages: [], more: false });
        void loadFeed();
        return;
      }
      set({ threads: rows });
      const known = rows.some((r) => r.id === state.thread);
      const chosen = known ? state.thread : (rows.find((r) => r.default) ?? rows[0]).id;
      if (chosen !== state.thread) openThread(chosen);
      // Остальные ветки - в фоне: переключение на них тоже должно быть сразу.
      for (const row of rows) {
        if (row.id !== chosen && !cache.has(row.id)) void reload(row.id);
      }
    });
  }
  return () => {
    readers = Math.max(0, readers - 1);
    leave();
  };
}

/**
 * Просто быть в комнате: соединение без ленты.
 *
 * Этим держится присутствие. Оболочка кабинета зовёт его на любой странице -
 * человек, ушедший в анализы или в маркет, с сайта никуда не делся, и
 * пропадать из «кто в сети» он не должен. Историю при этом не тянем: там сотня
 * сообщений, и грузить их тому, кто в чат даже не смотрит, незачем.
 */
export function attend(): () => void {
  users += 1;
  connect();
  return () => {
    users = Math.max(0, users - 1);
    if (users > 0) return;
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
    socket?.close();
    socket = null;
    set({ live: false });
  };
}

/**
 * Перечитать ленту выбранной ветки.
 *
 * Целиком, а не дописыванием: у каждой ветки свой разговор, и склеивать их в
 * одну ленту - это чат, в котором ответы стоят под чужими вопросами.
 */
async function reload(thread: number): Promise<void> {
  const fresh = await history(undefined, thread);
  // Пока ехал ответ, могли открыть другую ветку: он ложится в свою, а не в
  // открытую. Раньше быстрое переключение показывало разговор соседней ветки.
  if (thread !== state.thread) {
    cache.set(thread, merge(cached(thread), fresh));
    return;
  }
  set(merge({ messages: state.messages, more: state.more }, fresh));
}

/** Общая лента без веток - так чат жил до них, и так живёт, если их нет. */
async function loadFeed(): Promise<void> {
  const fresh = await history();
  // Ветки успели появиться - общая лента уже не нужна.
  if (state.thread) return;
  set(merge({ messages: state.messages, more: state.more }, fresh));
}

/**
 * Открыть другую ветку.
 *
 * Сразу тем, что уже привезли, и следом - свежим с сервера: ждать ответа с
 * пустой панелью незачем, если разговор этой ветки уже лежит здесь.
 */
export function openThread(thread: number): void {
  if (thread === state.thread) return;
  rememberThread(thread);
  set({ thread, ...cached(thread), ...cleared(thread) });
  void reload(thread);
}

/** Панель открыта: считать пришедшее прочитанным. */
export function setReading(value: boolean): void {
  reading = value;
  // Прочитанной становится открытая ветка, а не весь чат: в соседних лежит
  // разговор, которого трейдер не видел, и стирать их метки нечестно.
  if (value && (state.unreadByThread[state.thread] ?? 0) > 0) set(cleared(state.thread));
}

/** Сколько всего непрочитанного по всем веткам. */
function total(counts: Record<number, number>): number {
  let sum = 0;
  for (const count of Object.values(counts)) sum += count;
  return sum;
}

/** Ветку прочитали: её счётчик обнуляем, общий пересчитываем. */
function cleared(thread: number): Pick<ChatState, "unread" | "unreadByThread"> {
  const counts = { ...state.unreadByThread };
  delete counts[thread];
  return { unread: total(counts), unreadByThread: counts };
}

/** Дочитать историю вверх. */
export async function older(): Promise<void> {
  const oldest = state.messages[0];
  if (!oldest || !state.more) return;
  const thread = state.thread;
  const { messages, more } = await history(oldest.id, thread || null);
  // Пока листали, открыли другую ветку - старое этой ветки туда не кладём.
  if (thread !== state.thread) return;
  if (messages.length === 0) {
    set({ more: false });
    return;
  }
  set({ messages: [...messages, ...state.messages], more });
}

/**
 * Сколько ждём карточку, прежде чем отправить сообщение без неё.
 *
 * Ждать её вообще - осознанно: сообщение должно уйти в форум уже со ссылкой,
 * дослать её потом означало бы править в Telegram то, что там уже прочли. Но
 * ждать бесконечно нельзя: пока карточка выкладывалась, кнопка отправки стояла
 * зажатой, и человек не мог написать вообще ничего - ни этой сделки, ни
 * следующего слова. Разговор важнее иллюстрации к нему.
 */
const CARD_WAIT_MS = 15_000;

/** Пустое обещание по сроку: им ограничивают ожидание чего-то долгого. */
function afterMs(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

/**
 * Написать в чат. Сообщение появляется в ленте ответом сервера.
 *
 * Возвращает жалобу сервера на сигнал, если он не собрался: сообщение при этом
 * ушло, и объявлять отправку неудачей нельзя - но и промолчать о том, что
 * сигнала не будет, тоже.
 */
export async function post(
  text: string,
  attach?: ChatAttach | null,
  extras: SendExtras = {},
): Promise<string | null> {
  // Карточка собирается здесь, а не там, где сделку выбирают: путей к отправке
  // несколько - панель чата, терминал, журнал, - и повторять сборку в каждом
  // значит однажды забыть её в одном.
  //
  // Ждём её до отправки намеренно: сообщение должно уйти в форум уже со
  // ссылкой. Дослать её потом означало бы править в Telegram сообщение,
  // которое там уже прочли.
  let ready = attach ?? null;
  if (ready?.kind === "trade" && !ready.url) {
    const card = await Promise.race([
      cardLink(ready.trade, state.me?.name ?? ""),
      afterMs(CARD_WAIT_MS),
    ]);
    if (card) ready = { ...ready, url: card.url, image: card.image };
  }

  const message = await sendMessage(text, ready, {
    ...extras,
    threadId: extras.threadId ?? (state.thread || null),
  });
  if (!message) return null;
  if (!state.messages.some((m) => m.id === message.id)) {
    set({ messages: [...state.messages, message] });
  }
  return message.signalError ?? null;
}

/** Поправить своё сообщение. */
export async function change(id: number, text: string): Promise<void> {
  const message = await editMessage(id, text);
  if (!message) return;
  set({ messages: state.messages.map((m) => (m.id === message.id ? message : m)) });
}

/**
 * Убрать сообщение.
 *
 * Из ленты убираем сразу, не дожидаясь рассылки: тот, кто нажал, обязан увидеть
 * результат в тот же кадр. Отказавший сервер вернёт сообщение назад при
 * следующем чтении истории.
 */
export async function drop(id: number): Promise<void> {
  const kept = state.messages;
  set({ messages: state.messages.filter((m) => m.id !== id) });
  try {
    await removeMessage(id);
  } catch {
    set({ messages: kept });
  }
}
