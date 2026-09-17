"use client";

// В какую сделку положить снимок.
//
// Снимок делают в работе: цена дошла до уровня, стакан встал плитой, цель
// сработала - и это надо сохранить сейчас, а не искать потом в журнале. Окно
// показывает сделки, которые идут прямо сейчас, и кладёт снимок в выбранную.
//
// Сделка одна - выбирать не из чего, и окно не открывается вовсе: снимок
// уходит в неё сразу. Спрашивать «в эту?» там, где ответ единственный, -
// лишний шаг посреди работы.

import { useEffect } from "react";
import { X } from "lucide-react";

import ModalPortal from "@/components/ui/ModalPortal";
import { useT } from "@/lib/i18n";
import type { ActiveTrade } from "@/lib/trade/position";

export interface PickTradeProps {
  /**
   * Сделки, в которые можно положить снимок.
   *
   * Порядок задаёт вызывающий: открытые первыми, ждущие заявки под ними.
   * Снимок кладут в то, что идёт сейчас, а заявка - это ещё замысел.
   */
  trades: readonly ActiveTrade[];
  onPick: (trade: ActiveTrade) => void;
  onClose: () => void;
}

export default function PickTrade({ trades, onPick, onClose }: PickTradeProps) {
  const t = useT();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // В общий слой страницы: терминал завёрнут в свою стопку слоёв, и окно,
    // нарисованное внутри него, не может подняться над шапкой сайта.
    <ModalPortal>
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--pane-border)] px-3 py-2">
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">
            {t.terminal.shotToTradeTitle}
          </h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            title={t.journal.close}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-auto py-1">
          {trades.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-[var(--pane-muted)]">
              {t.terminal.shotToTradeEmpty}
            </p>
          ) : (
            trades.map((trade, i) => (
              <button
                key={trade.id}
                onClick={() => onPick(trade)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)] ${
                  // Черта перед первой ждущей заявкой: открытые сделки и
                  // замыслы - разные вещи, и в одном списке их надо разделить.
                  trade.status === "planned" && trades[i - 1]?.status === "open"
                    ? "border-t border-[var(--pane-border)]"
                    : ""
                } ${trade.status === "planned" ? "opacity-70" : ""}`}
              >
                <span
                  className={`font-mono text-[11px] font-bold ${
                    trade.side === "long"
                      ? "text-[var(--pane-up)]"
                      : "text-[var(--pane-down)]"
                  }`}
                >
                  {trade.symbol.replace(/USDT$/, "")}
                </span>
                <span className="text-[10px] text-[var(--pane-muted)]">
                  ×{trade.leverage} ·{" "}
                  {trade.status === "open"
                    ? t.terminal.shotToTradeOpen(trade.takesHit, trade.targets.length)
                    : t.terminal.shotToTradeWaiting}
                </span>
                <div className="flex-1" />
                <span className="font-mono text-[10px] text-[var(--pane-text-2)]">
                  {trade.entry}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
