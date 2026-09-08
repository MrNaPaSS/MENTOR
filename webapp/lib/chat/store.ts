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

import { API_URL } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import {
  edit as editMessage,
  history,
  normalize,
  remove as removeMessage,
  send as sendMessage,
  type ChatAttach,
  type ChatAuthor,
  type ChatMessage,
} from "./api";

export type { ChatAttach, ChatAuthor, ChatMessage, SharedTrade } from "./api";

export type ChatState = {
  messages: ChatMessage[];
  /** Кто сейчас в комнате. Приходит от сервера, а не считается по ленте. */
  people: ChatAuthor[];
  /** Кто мы: по нему сообщение узнаёт себя и прижимается вправо. */
  me: ChatAuthor | null;
  /** Есть ли ещё история выше загруженного. */
  more: boolean;
  /** Непрочитанные: считаются, пока панель закрыта. */
  unread: number;
  /** Живой канал открыт. Нет - лента остаётся, но новое не приедет. */
  live: boolean;
};

const EMPTY: ChatState = {
  messages: [],
  people: [],
  me: null,
  more: false,
  unread: 0,
  live: false,
};

let state: ChatState = EMPTY;
const listeners = new Set<() => void>();

function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
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

let socket: WebSocket | null = null;
let users = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
// Растущая пауза перед повтором: сеть падает не на секунду, и долбить сервер
// каждые полсекунды - верный способ не пустить обратно и тех, кто дождался.
let wait = 1000;
/** Панель открыта и её видно: пришедшее считается прочитанным сразу. */
let reading = false;

function connect() {
  const token = getAccessToken();
  if (!token || socket || users === 0) return;

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
      set({ me: you ? host(you) : null, people: people.map(host) });
      return;
    }
    if (frame.event === "people") {
      set({ people: ((frame.payload.people ?? []) as ChatAuthor[]).map(host) });
      return;
    }
    if (frame.event === "edited") {
      const edited = normalize(frame.payload as never);
      set({ messages: state.messages.map((m) => (m.id === edited.id ? edited : m)) });
      return;
    }
    if (frame.event === "removed") {
      const id = Number(frame.payload.id);
      set({ messages: state.messages.filter((m) => m.id !== id) });
      return;
    }
    if (frame.event === "message") {
      const message = normalize(frame.payload as never);
      // Своё сообщение уже лежит в ленте: его положил ответ на отправку.
      if (state.messages.some((m) => m.id === message.id)) return;
      set({
        messages: [...state.messages, message],
        unread: reading ? 0 : state.unread + 1,
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
  users += 1;
  if (users === 1) {
    void history().then(({ messages, more }) => {
      // История приходит один раз: если пока её везли, сокет успел принести
      // новое, дописываем его следом, а не затираем.
      const known = new Set(messages.map((m) => m.id));
      const later = state.messages.filter((m) => !known.has(m.id));
      set({ messages: [...messages, ...later], more });
    });
    connect();
  }
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

/** Панель открыта: считать пришедшее прочитанным. */
export function setReading(value: boolean): void {
  reading = value;
  if (value && state.unread > 0) set({ unread: 0 });
}

/** Дочитать историю вверх. */
export async function older(): Promise<void> {
  const oldest = state.messages[0];
  if (!oldest || !state.more) return;
  const { messages, more } = await history(oldest.id);
  if (messages.length === 0) {
    set({ more: false });
    return;
  }
  set({ messages: [...messages, ...state.messages], more });
}

/** Написать в чат. Сообщение появляется в ленте ответом сервера. */
export async function post(text: string, attach?: ChatAttach | null): Promise<void> {
  const message = await sendMessage(text, attach);
  if (!message) return;
  if (state.messages.some((m) => m.id === message.id)) return;
  set({ messages: [...state.messages, message] });
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
