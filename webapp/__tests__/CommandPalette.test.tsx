/**
 * Палитра символов по Ctrl+K (ТЗ этап 5, §8.2).
 *
 * Проверяется то, ради чего оговорки в ТЗ и написаны: палитра открывается
 * сочетанием, ищет по подстроке, закрывается по Esc и **молчит, пока человек
 * печатает** - иначе Ctrl+K украли бы у сообщения в чате.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { filterSymbols, isTyping, moveCursor, opensPalette } from "@/lib/commandPalette";

const marketSymbols = vi.fn(async () => ({
  symbols: ["BTCUSDT", "ETHUSDT", "ETHFIUSDT", "SOLUSDT", "TONUSDT"],
}));

vi.mock("@/lib/api", () => ({
  api: { marketSymbols: () => marketSymbols() },
}));

import CommandPalette from "@/components/app/CommandPalette";

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(document, { key, ...init });
}

beforeEach(() => {
  localStorage.clear();
  marketSymbols.mockClear();
});

// ── Счёт и отбор ─────────────────────────────────────────────────────────────

describe("opensPalette", () => {
  it("открывается на Ctrl+K и на ⌘K", () => {
    expect(opensPalette({ key: "k", ctrlKey: true })).toBe(true);
    expect(opensPalette({ key: "K", metaKey: true })).toBe(true);
  });

  it("молчит без модификатора и на чужих сочетаниях", () => {
    expect(opensPalette({ key: "k" })).toBe(false);
    expect(opensPalette({ key: "k", ctrlKey: true, altKey: true })).toBe(false);
    expect(opensPalette({ key: "j", ctrlKey: true })).toBe(false);
  });

  it("молчит, пока человек печатает: сочетание принадлежит чату", () => {
    expect(opensPalette({ key: "k", ctrlKey: true }, { tagName: "INPUT" })).toBe(false);
    expect(opensPalette({ key: "k", ctrlKey: true }, { tagName: "TEXTAREA" })).toBe(false);
    expect(opensPalette({ key: "k", ctrlKey: true }, { isContentEditable: true })).toBe(false);
  });
});

describe("isTyping", () => {
  it("узнаёт поля ввода и редактируемые блоки", () => {
    expect(isTyping({ tagName: "DIV" })).toBe(false);
    expect(isTyping({ tagName: "input" })).toBe(true);
    expect(isTyping(null)).toBe(false);
  });
});

describe("filterSymbols", () => {
  const list = ["BTCUSDT", "ETHUSDT", "ETHFIUSDT", "SOLUSDT"];

  it("совпадение с начала идёт раньше совпадения в середине", () => {
    expect(filterSymbols(list, "ETH")).toEqual(["ETHUSDT", "ETHFIUSDT"]);
    expect(filterSymbols(list, "USDT")[0]).toBe("BTCUSDT");
  });

  it("без запроса показывает начало списка", () => {
    expect(filterSymbols(list, "", 2)).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("ищет без оглядки на регистр и пробелы", () => {
    expect(filterSymbols(list, " sol ")).toEqual(["SOLUSDT"]);
  });
});

describe("moveCursor", () => {
  it("замыкает список в кольцо", () => {
    expect(moveCursor(0, -1, 3)).toBe(2);
    expect(moveCursor(2, 1, 3)).toBe(0);
  });

  it("не падает на пустом списке", () => {
    expect(moveCursor(0, 1, 0)).toBe(0);
  });
});

// ── Сама палитра ─────────────────────────────────────────────────────────────

describe("палитра на экране", () => {
  it("до вызова её нет вовсе", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("открывается сочетанием и спрашивает список пар", async () => {
    render(<CommandPalette />);
    press("k", { ctrlKey: true });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(marketSymbols).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("BTCUSDT")).toBeTruthy());
  });

  it("ищет по подстроке", async () => {
    render(<CommandPalette />);
    press("k", { ctrlKey: true });
    const field = await screen.findByRole("textbox");
    await waitFor(() => expect(screen.getByText("SOLUSDT")).toBeTruthy());

    fireEvent.change(field, { target: { value: "ton" } });

    expect(screen.getByText("TONUSDT")).toBeTruthy();
    expect(screen.queryByText("SOLUSDT")).toBeNull();
  });

  it("Enter меняет активный символ и закрывает палитру", async () => {
    render(<CommandPalette />);
    press("k", { ctrlKey: true });
    const field = await screen.findByRole("textbox");
    await waitFor(() => expect(screen.getByText("BTCUSDT")).toBeTruthy());

    fireEvent.change(field, { target: { value: "sol" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem("nmnh.symbol.active")).toBe("SOLUSDT");
  });

  it("Esc закрывает и ничего не меняет", async () => {
    render(<CommandPalette />);
    press("k", { ctrlKey: true });
    const field = await screen.findByRole("textbox");

    fireEvent.keyDown(field, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem("nmnh.symbol.active")).toBeNull();
  });

  it("не открывается, когда набирают в поле ввода", async () => {
    render(
      <div>
        <input aria-label="сообщение" />
        <CommandPalette />
      </div>,
    );
    const chat = screen.getByLabelText("сообщение");
    chat.focus();
    fireEvent.keyDown(chat, { key: "k", ctrlKey: true });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
