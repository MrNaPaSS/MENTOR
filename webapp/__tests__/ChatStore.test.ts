import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatThread } from "@/lib/chat/api";

// Ветки чата должны открываться сразу: переключение, которое ждёт ответа
// сервера с пустой панелью, читается как «чат тормозит». И ни при каком
// переключении разговор одной ветки не должен оказаться в другой.

vi.mock("@/lib/chat/api", () => ({
  history: vi.fn(),
  threads: vi.fn(),
  normalize: (raw: unknown) => raw,
  edit: vi.fn(),
  remove: vi.fn(),
  send: vi.fn(),
}));

function msg(id: number, threadId: number): ChatMessage {
  return {
    id,
    text: `#${id}`,
    at: id,
    edited: 0,
    author: { id: 1, name: "a", avatar: "", mentor: false },
    threadId,
    links: [],
  };
}

const THREADS: ChatThread[] = [
  { id: 1, title: "Общий", closed: false, default: true, forum: false },
  { id: 2, title: "Сделки", closed: false, default: false, forum: false },
];

const PAGES: Record<number, ChatMessage[]> = {
  1: [msg(10, 1), msg(11, 1)],
  2: [msg(20, 2), msg(21, 2)],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Дать отработать уже разрешённым обещаниям. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function fresh() {
  vi.resetModules();
  const api = await import("@/lib/chat/api");
  const store = await import("@/lib/chat/store");
  return { api: vi.mocked(api), store };
}

beforeEach(() => {
  localStorage.clear();
});

describe("ветки чата", () => {
  it("подгруженная ветка открывается сразу, не дожидаясь сервера", async () => {
    const { api, store } = await fresh();
    api.threads.mockResolvedValue(THREADS);
    api.history.mockImplementation(async (_before, thread) => ({
      messages: PAGES[thread ?? 0] ?? [],
      more: false,
    }));

    store.open();
    await settle();
    expect(store.snapshot().messages.map((m) => m.id)).toEqual([10, 11]);

    // Сервер больше не отвечает - а ветка всё равно открывается сразу.
    api.history.mockImplementation(() => new Promise(() => {}));
    store.openThread(2);
    expect(store.snapshot().thread).toBe(2);
    expect(store.snapshot().messages.map((m) => m.id)).toEqual([20, 21]);
  });

  it("опоздавший ответ ложится в свою ветку, а не в открытую", async () => {
    const { api, store } = await fresh();
    api.threads.mockResolvedValue(THREADS);
    const first = deferred<{ messages: ChatMessage[]; more: boolean }>();
    api.history.mockImplementation((_before, thread) =>
      thread === 1 ? first.promise : Promise.resolve({ messages: PAGES[2], more: false }),
    );

    store.open();
    await settle();
    store.openThread(2);
    await settle();

    // Ответ по первой ветке приходит, когда открыта уже вторая.
    first.resolve({ messages: PAGES[1], more: false });
    await settle();
    expect(store.snapshot().thread).toBe(2);
    expect(store.snapshot().messages.map((m) => m.id)).toEqual([20, 21]);

    // А в первой он на месте.
    api.history.mockImplementation(() => new Promise(() => {}));
    store.openThread(1);
    expect(store.snapshot().messages.map((m) => m.id)).toEqual([10, 11]);
  });

  it("ветку, открытую в прошлый раз, просим сразу, не дожидаясь списка веток", async () => {
    localStorage.setItem("nmnh.chat.thread", "2");
    const { api, store } = await fresh();
    api.threads.mockImplementation(() => new Promise(() => {}));
    api.history.mockResolvedValue({ messages: PAGES[2], more: false });

    store.open();
    expect(api.history).toHaveBeenCalledWith(undefined, 2);
    await settle();
    expect(store.snapshot().messages.map((m) => m.id)).toEqual([20, 21]);
  });

  it("выбранная ветка запоминается на следующий раз", async () => {
    const { api, store } = await fresh();
    api.threads.mockResolvedValue(THREADS);
    api.history.mockResolvedValue({ messages: [], more: false });

    store.open();
    await settle();
    store.openThread(2);
    expect(localStorage.getItem("nmnh.chat.thread")).toBe("2");
  });
});
