"use client";

// Что сделать с уровнем из стакана.
//
// Нажатие по строке раньше вело сразу в расчёт сделки, а отметка на цене
// ставилась двойным нажатием — жестом, о котором нельзя догадаться. Теперь оба
// действия названы словами и стоят рядом: трейдер выбирает, а не вспоминает.
//
// Окно намеренно крошечное и без полей ввода: это развилка на два шага, а не
// форма. Всё, что нужно решить дальше, спросит окно расчёта.

import { useEffect } from "react";
import { Bell, BellOff, Calculator } from "lucide-react";
import { money, price as fmtPrice, type LadderRow } from "@/lib/scalping";

const ITEM =
  "flex w-full items-center gap-3 rounded-lg border border-[var(--pane-border)] px-3 py-2.5 text-left " +
  "transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)]";

export default function LevelMenu({
  row,
  tick,
  alerted,
  onTrade,
  onAlert,
  onCancel,
}: {
  row: LadderRow;
  tick: number;
  /** На этой цене отметка уже стоит — предлагаем снять, а не поставить снова. */
  alerted: boolean;
  onTrade: () => void;
  onAlert: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // Обработчик снимается вместе с окном, поэтому пересоздавать его не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bid = row.bid > 0;

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
      onClick={onCancel}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[320px] max-w-full animate-dialog-in overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
      >
        <div className="border-b border-[var(--pane-border)] px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[17px] font-semibold text-[var(--pane-text)]">
              {fmtPrice(row.price, tick)}
            </span>
            <span
              className={`text-[11px] ${bid ? "text-[var(--pane-up)]" : "text-[var(--pane-down)]"}`}
            >
              {money(row.notional)}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">
            {bid ? "заявки на покупку - поддержка" : "заявки на продажу - сопротивление"}
          </p>
        </div>

        <div className="flex flex-col gap-2 p-3">
          <button onClick={onTrade} className={ITEM}>
            <Calculator className="h-4 w-4 shrink-0 text-[var(--pane-accent)]" />
            <span>
              <span className="block text-[12px] font-semibold text-[var(--pane-text)]">
                Расчёт сделки
              </span>
              <span className="block text-[11px] text-[var(--pane-muted)]">
                {bid ? "лонг от этого уровня" : "шорт от этого уровня"}
              </span>
            </span>
          </button>

          <button onClick={onAlert} className={ITEM}>
            {alerted ? (
              <BellOff className="h-4 w-4 shrink-0 text-[var(--pane-muted)]" />
            ) : (
              <Bell className="h-4 w-4 shrink-0 text-[var(--pane-gold)]" />
            )}
            <span>
              <span className="block text-[12px] font-semibold text-[var(--pane-text)]">
                {alerted ? "Убрать уведомление" : "Уведомление на пересечение"}
              </span>
              <span className="block text-[11px] text-[var(--pane-muted)]">
                {alerted ? "цена больше не отслеживается" : "скажем, когда цена дойдёт сюда"}
              </span>
            </span>
          </button>
        </div>

        <div className="flex justify-end border-t border-[var(--pane-border)] px-3 py-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
