"use client";

// Уведомления поверх терминала.
//
// Строка внизу графика годится для ответа на нажатие: трейдер только что нажал
// и смотрит туда. Но лимитка исполняется сама, и почти всегда - когда трейдер
// смотрит на другую монету. Такое событие обязано перехватить взгляд, поэтому
// оно приходит сверху по центру, поверх всего.
//
// Уведомление само уходит через несколько секунд и убирается нажатием: висеть
// над графиком дольше нужного ему нечего.

import { useEffect } from "react";
import { X } from "lucide-react";

export type Toast = {
  id: string;
  /** Монета, о которой речь. Пусто - уведомление не про монету. */
  symbol?: string;
  title: string;
  text: string;
  tone: "up" | "down" | "plain";
};

/** Сколько уведомление висит само, миллисекунды. */
const LIFE = 9000;

export default function Toasts({
  items,
  onClose,
  onPick,
}: {
  items: Toast[];
  onClose: (id: string) => void;
  /** Нажали по уведомлению: открываем ту монету, о которой оно. */
  onPick?: (symbol: string) => void;
}) {
  // Гасим по одному и по своему сроку: общий таймер снимал бы свежее
  // уведомление вместе со старым.
  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((item) => setTimeout(() => onClose(item.id), LIFE));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.id).join("|")]);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2">
      {items.map((item) => {
        const tone =
          item.tone === "up"
            ? "var(--pane-up)"
            : item.tone === "down"
              ? "var(--pane-down)"
              : "var(--pane-accent)";
        return (
          <div
            key={item.id}
            onClick={() => item.symbol && onPick?.(item.symbol)}
            className={
              "pointer-events-auto flex animate-fade-in items-center gap-3 rounded-lg border " +
              "px-3 py-2 shadow-xl motion-reduce:animate-none " +
              (item.symbol ? "cursor-pointer" : "")
            }
            style={{
              borderColor: tone,
              background: "var(--pane-bg)",
              color: "var(--pane-text)",
            }}
          >
            <span
              aria-hidden
              className="h-6 w-1 shrink-0 rounded-full"
              style={{ background: tone }}
            />
            <span className="flex flex-col leading-tight">
              <span className="text-[12px] font-semibold" style={{ color: tone }}>
                {item.title}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-[var(--pane-text-2)]">
                {item.text}
              </span>
            </span>
            <button
              onClick={(event) => {
                // Крестик закрывает уведомление, а не открывает монету.
                event.stopPropagation();
                onClose(item.id);
              }}
              title="Убрать"
              className="ml-1 text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
