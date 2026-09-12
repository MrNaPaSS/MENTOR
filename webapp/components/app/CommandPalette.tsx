"use client";

// Палитра символов: `Ctrl+K` меняет пару (ТЗ этап 5, §8.2).
//
// Главный её сценарий - полноэкранный терминал. Шапки кабинета там нет, и
// сменить пару иначе нечем: надо выходить из полного экрана, искать монету в
// скринере и возвращаться обратно.
//
// Два правила, ради которых палитра вообще может существовать рядом с чатом и
// стаканом:
//
//   пока человек печатает, сочетание ему не принадлежит - в поле ввода и в
//   чате `Ctrl+K` не перехватывается вовсе;
//
//   клавиши стакана старше: свои сочетания там уже есть, и палитра слушает
//   только `Ctrl+K`, ничего больше.

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { api } from "@/lib/api";
import { filterSymbols, isTyping, moveCursor, opensPalette } from "@/lib/commandPalette";
import { askSymbol } from "@/lib/openSymbol";
import { readActiveSymbol, setActiveSymbol } from "@/lib/symbolLink";

/** Список пар живёт долго: он меняется, когда биржа заводит новый контракт. */
const SYMBOLS_TTL_MS = 10 * 60_000;

export default function CommandPalette() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [symbols, setSymbols] = useState<string[]>([]);
  const loadedAt = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (Date.now() - loadedAt.current < SYMBOLS_TTL_MS && symbols.length) return;
    api
      .marketSymbols()
      .then((r) => {
        setSymbols(r.symbols ?? []);
        loadedAt.current = Date.now();
      })
      .catch(() => {
        // Список не пришёл - палитра покажет пустоту с подписью, а не сломает
        // страницу. Активная пара от этого не меняется.
      });
  }, [symbols.length]);

  // Вызов палитры. Слушаем на документе: фокус может быть где угодно, а в
  // полном экране - вообще на холсте графика.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (opensPalette(event, event.target as HTMLElement | null)) {
        event.preventDefault();
        setOpen((was) => !was);
        setQuery("");
        setCursor(0);
        load();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [load]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const rows = useMemo(() => filterSymbols(symbols, query), [symbols, query]);
  const active = readActiveSymbol();

  function choose(symbol: string) {
    setActiveSymbol(symbol);
    // Терминал открыт - услышит событие; закрыт - прочтёт пару из адреса.
    askSymbol(symbol);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((was) => moveCursor(was, event.key === "ArrowDown" ? 1 : -1, rows.length));
      return;
    }
    if (event.key === "Enter" && rows[cursor]) {
      event.preventDefault();
      choose(rows[cursor]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-[min(92vw,420px)] overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t.terminal.palette.title}
      >
        <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-[var(--pane-muted)]" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t.terminal.palette.placeholder}
            aria-label={t.terminal.palette.title}
            className="w-full bg-transparent text-[13px] text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)]"
          />
        </div>

        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {rows.map((symbol, i) => (
            <li key={symbol}>
              <button
                onClick={() => choose(symbol)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[13px] ${
                  i === cursor
                    ? "bg-[var(--pane-border)] text-[var(--pane-text)]"
                    : "text-[var(--pane-text-2)]"
                }`}
              >
                <span className="font-semibold">{symbol}</span>
                {symbol === active && (
                  <span className="text-[10px] uppercase tracking-wider text-[var(--pane-gold)]">
                    {t.terminal.palette.current}
                  </span>
                )}
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-3 py-3 text-[12px] text-[var(--pane-muted)]">
              {t.terminal.palette.empty}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Нужно компонентам, которые сами решают, мешать ли им сочетание. */
export { isTyping };
