"use client";

// Уведомления поверх терминала.
//
// Строка внизу графика годится для ответа на нажатие: трейдер только что нажал
// и смотрит туда. Но лимитка исполняется сама, и почти всегда - когда трейдер
// смотрит на другую монету. Такое событие обязано перехватить взгляд, поэтому
// оно приходит вверху по центру графика - там, куда смотрят.
//
// Не на весь экран, а на график. Прежде уведомление висело у верхнего края
// окна: в оконном режиме это шапка сайта, то есть мимо взгляда, а на широком
// мониторе - вообще другой конец стекла.
//
// Уведомление само уходит через несколько секунд и убирается нажатием: висеть
// над графиком дольше нужного ему нечего.

import { useT } from "@/lib/i18n";
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
  place = "chart",
}: {
  items: Toast[];
  onClose: (id: string) => void;
  /** Нажали по уведомлению: открываем ту монету, о которой оно. */
  onPick?: (symbol: string) => void;
  /**
   * Где висят.
   *
   * `chart` - вверху графика, там, куда смотрят, пока терминал открыт.
   * `shell` - под шапкой кабинета: в других разделах графика нет, а событие
   * приходит всё равно.
   */
  place?: "chart" | "shell";
}) {
  const t = useT();
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
    <div
      className={
        "pointer-events-none z-40 flex flex-col items-center gap-2 px-2 " +
        (place === "shell"
          ? "fixed inset-x-0 top-[104px] z-[60]"
          : "absolute inset-x-0 top-10")
      }
    >
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
              "pointer-events-auto flex max-w-full animate-fade-in items-center gap-3 rounded-xl " +
              "border px-4 py-2.5 backdrop-blur-sm transition-shadow duration-200 " +
              "motion-reduce:animate-none " +
              (item.symbol ? "cursor-pointer" : "")
            }
            style={{
              borderColor: tone,
              background: "var(--pane-bg)",
              color: "var(--pane-text)",
              // Две тени: мягкая чёрная кладёт плашку над графиком, цветная
              // подсвечивает её изнутри цветом события. Одна чёрная на светлой
              // теме выглядит грязным пятном, одна цветная на тёмной - не
              // отделяет плашку от свечей под ней.
              boxShadow: `0 10px 30px -8px rgba(0, 0, 0, 0.45), 0 0 22px -6px ${tone}`,
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
              title={t.domScreener.dismiss}
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
