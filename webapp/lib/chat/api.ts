"use client";

// Запросы чата: история, отправка, предпросмотр ссылки и загрузка фотографии.
//
// Живое приходит сокетом, здесь всё, что спрашивают один раз или по нажатию.

import { API_URL, authReq } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

/** Кто написал: так, как он выглядит в ленте сейчас. */
export type ChatAuthor = {
  id: number;
  name: string;
  /** Путь на бэкенде; к нему уже добавлен адрес сервера. Пусто - фото нет. */
  avatar: string;
  mentor: boolean;
};

/** Сделка или заявка, которой поделились: снимок цифр на момент отправки. */
export type SharedTrade = {
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  targets: number[];
  qty: number;
  leverage: number;
  state: "planned" | "open" | "closed";
  pnl?: number | null;
  takesHit?: number;
  /** Маржа: по ней считается результат в процентах, а не в одних долларах. */
  margin?: number;
  /** Чем кончилась: стопом, целью или закрыли руками. */
  outcome?: "stop" | "take" | "manual";
  /** Комиссия обеих ног - по ней видно, почему на счёт пришло меньше. */
  fee?: number;
  /**
   * Когда сделка закрылась, строкой ISO.
   *
   * Нужна карточке результата: она заверяется датой, и у закрытой сделки это
   * дата закрытия, а не дата разговора о ней. У идущей её нет - там карточку
   * подписывает время сообщения.
   */
  closedAt?: string;
};

export type ChatAttach =
  | { kind: "shot"; url: string; image: string }
  | { kind: "trade"; trade: SharedTrade };

/** Снимок того, на что отвечают: ник, начало текста и вид вложения. */
export type ChatQuote = {
  id: number;
  author?: string;
  text?: string;
  attach?: "shot" | "trade" | null;
  /** Оригинал удалён: цитата остаётся, но перестаёт быть нажимаемой. */
  deleted?: boolean;
};

export type ChatMessage = {
  id: number;
  text: string;
  /** Время отправки в миллисекундах: формат зависит от языка, строкой не держим. */
  at: number;
  /** Когда поправили. Ноль - не правили. */
  edited: number;
  author: ChatAuthor;
  attach?: ChatAttach | null;
  /** На что отвечает. Пусто - самостоятельная реплика. */
  reply?: ChatQuote | null;
  /** Заявка ушла во вкладку «Сигналы». */
  signalId?: number | null;
};

type RawMessage = Omit<ChatMessage, "at" | "edited" | "author" | "signalId"> & {
  at: string;
  edited: string | null;
  author: ChatAuthor;
  signal_id: number | null;
};

/** Аватарка приходит путём на бэкенде, а сайт живёт на другом домене. */
export function withHost(author: ChatAuthor): ChatAuthor {
  return { ...author, avatar: author.avatar ? `${API_URL}${author.avatar}` : "" };
}

export function normalize(raw: RawMessage): ChatMessage {
  return {
    ...raw,
    at: new Date(raw.at).getTime(),
    edited: raw.edited ? new Date(raw.edited).getTime() : 0,
    author: withHost(raw.author),
    signalId: raw.signal_id ?? null,
  };
}

function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = getAccessToken();
  if (!token) return Promise.resolve(null);
  return authReq<T>(path, token, init);
}

/** Страница истории. `before` - читать то, что старше этого сообщения. */
export async function history(before?: number): Promise<{ messages: ChatMessage[]; more: boolean }> {
  const body = await request<{ messages: RawMessage[]; more: boolean }>(
    `/api/chat/messages${before ? `?before=${before}` : ""}`,
  );
  if (!body) return { messages: [], more: false };
  return { messages: body.messages.map(normalize), more: body.more };
}

/** Чем сообщение может быть, кроме текста и вложения. */
export type SendExtras = {
  /** На какое сообщение отвечаем. */
  replyTo?: number | null;
  /** Показать заявку во вкладке «Сигналы». Право проверяет сервер. */
  asSignal?: boolean;
  audience?: "all" | "moderate" | "turbo";
};

export async function send(
  text: string,
  attach?: ChatAttach | null,
  extras: SendExtras = {},
): Promise<(ChatMessage & { signalError?: string }) | null> {
  const body = await request<RawMessage & { signal_error?: string }>("/api/chat/messages", {
    method: "POST",
    body: JSON.stringify({
      text,
      attach: attach ?? null,
      reply_to: extras.replyTo ?? null,
      as_signal: Boolean(extras.asSignal),
      audience: extras.audience ?? "all",
    }),
  });
  if (!body) return null;
  return { ...normalize(body), signalError: body.signal_error };
}

/** Поправить своё сообщение. */
export async function edit(id: number, text: string): Promise<ChatMessage | null> {
  const body = await request<RawMessage>(`/api/chat/messages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ text }),
  });
  return body ? normalize(body) : null;
}

/** Убрать сообщение: своё - всегда, чужое - только наставнику. */
export async function remove(id: number): Promise<void> {
  await request<void>(`/api/chat/messages/${id}`, { method: "DELETE" });
}

export type LinkPreview = { title: string; description: string; image: string };

/** Заголовок и обложка чужой страницы. Не собралось - пустые строки. */
export async function preview(url: string): Promise<LinkPreview | null> {
  try {
    return await request<LinkPreview>(`/api/chat/link?url=${encodeURIComponent(url)}`);
  } catch {
    // Предпросмотр - украшение: панель покажет домен и без него.
    return null;
  }
}

/**
 * Фотография в чат.
 *
 * Кладём её туда же, где живут снимки графика, и по той же причине: у снимка
 * есть своя страница на сайте с превью в мессенджерах. Нажатие на фотографию в
 * ленте открывает её у нас, а не тянет файл в никуда.
 *
 * Сервер принимает только PNG, а из проводника приносят что угодно - поэтому
 * сначала перерисовываем картинку на холст. Заодно это отрезает всё лишнее,
 * что лежит в файле рядом с картинкой.
 */
export async function uploadPhoto(file: File, symbol: string): Promise<ChatAttach | null> {
  const png = await toPng(file);
  if (!png) return null;

  const token = getAccessToken();
  if (!token) return null;

  const body = await authReq<{ id: string; url: string }>("/api/shots", token, {
    method: "POST",
    body: JSON.stringify({ image: png, symbol: symbol || "CHAT", interval: "" }),
  });
  if (!body) return null;

  return {
    kind: "shot",
    url: `${API_URL}${body.url}`,
    image: `${API_URL}/${body.id}.png`,
  };
}

/** Максимальная сторона: снимок с телефона в четыре тысячи точек чату не нужен. */
const MAX_SIDE = 1600;

function toPng(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
