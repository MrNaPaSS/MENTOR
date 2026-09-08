"use client";

// Лента общего чата - на складе снаружи от React.
//
// Так же, как уведомления о сделках: писать в чат умеет не только он сам.
// Сделкой делятся из журнала, ожидающей заявкой - из панели чата, а завтра
// поделятся ещё откуда-нибудь. Держать ленту внутри компонента значило бы, что
// свернул панель - потерял разговор.
//
// Сервера у чата пока нет: лента живёт в памяти вкладки и уходит вместе с ней.
// Это честнее, чем localStorage: снимок с фотографией не влезет в отведённые
// браузером мегабайты, а половина разговора хуже, чем его отсутствие.

import type { Dict } from "@/lib/i18n";

/** Сделка или заявка, которой поделились: снимок, а не ссылка на живую. */
export type SharedTrade = {
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  targets: number[];
  qty: number;
  leverage: number;
  /** Ждёт входа, идёт или закрыта. */
  state: "planned" | "open" | "closed";
  /** Результат закрытой сделки, в деньгах. */
  pnl?: number | null;
  takesHit?: number;
};

export type ChatAttach =
  | { kind: "photo"; src: string; name: string }
  | { kind: "trade"; trade: SharedTrade };

export type ChatMessage = {
  id: number;
  author: string;
  text: string;
  /** Время отправки. Строкой не храним: формат зависит от языка. */
  at: number;
  self?: boolean;
  mentor?: boolean;
  attach?: ChatAttach;
};

let feed: ChatMessage[] = [];
let seeded = false;
const listeners = new Set<() => void>();

function emit() {
  // Новый массив на каждое изменение: useSyncExternalStore сравнивает ссылку.
  feed = [...feed];
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function snapshot(): ChatMessage[] {
  return feed;
}

/** На сервере ленты нет: разметка страницы не должна расходиться с браузером. */
export function serverSnapshot(): ChatMessage[] {
  return EMPTY;
}

const EMPTY: ChatMessage[] = [];

/** Написать в чат. Автор и время проставляются здесь. */
export function post(message: Omit<ChatMessage, "id" | "at">): void {
  feed.push({ ...message, id: Date.now() + Math.random(), at: Date.now() });
  emit();
}

/**
 * Первые сообщения - чтобы пустая панель не выглядела сломанной.
 *
 * Один раз за жизнь вкладки: панель открывают и сворачивают по десять раз за
 * сессию, и каждый раз досыпать наставника в ленту нельзя.
 */
export function seedOnce(t: Dict): void {
  if (seeded) return;
  seeded = true;
  const day = new Date();
  const at = (hour: number, minute: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();

  feed = [
    { id: 1, author: t.chat.mentor, text: t.chat.seed[0], at: at(9, 12), mentor: true },
    { id: 2, author: "alex", text: t.chat.seed[1], at: at(9, 20) },
    { id: 3, author: "sasha", text: t.chat.seed[2], at: at(9, 24) },
    { id: 4, author: t.chat.mentor, text: t.chat.seed[3], at: at(9, 26), mentor: true },
  ];
  emit();
}
