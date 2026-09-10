"use client";

// Кнопка «позиции» в строке графика и окно со всеми идущими сделками.
//
// Прежде на этом месте стоял чип «сделка ✕»: он знал только о сделках по
// открытой монете и открывал закрытие последней из них. Лимитки ставят на
// десяток монет разом, и узнать, что где стоит и сколько целей уже взято,
// можно было, только перебирая графики. Здесь всё одним списком, а нажатие на
// пару открывает её график - закрывают сделку уже там, с её ярлыка.

import { useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import type { ActiveTrade } from "@/lib/trade/position";

export default function PositionsChip({
  trades,
  current,
  className,
  onPick,
}: {
  /** Незакрытые сделки по всем монетам: и открытые, и ждущие входа. */
  trades: ActiveTrade[];
  /** Монета на графике сейчас - её строка выделена. */
  current: string | null;
  /** Вид самой кнопки: его задаёт строка графика, где стоят и соседние. */
  className: string;
  /** Открыть график монеты. */
  onPick: (symbol: string) => void;
}) {
  const t = useT();
  const p = t.terminal.positions;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Закрывается нажатием мимо и по Esc - как меню палитры рядом.
  useEffect(() => {
    if (!open) return;
    function away(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function esc(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const positions = trades.filter((x) => x.status === "open").length;
  const limits = trades.length - positions;
  // Сначала то, что уже в рынке: там деньги, и туда смотрят первым делом.
  const rows = [...trades].sort((a, b) =>
    a.status === b.status ? a.symbol.localeCompare(b.symbol) : a.status === "open" ? -1 : 1,
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={p.title(positions, limits)}
        aria-expanded={open}
        className={className}
      >
        {p.chip(trades.length)}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 w-64 overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] py-1 shadow-xl">
          <div className="px-3 pb-1 pt-0.5 text-[10px] text-[var(--pane-muted)]">
            {p.title(positions, limits)}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {rows.map((x) => (
              <Row
                key={x.id}
                trade={x}
                here={x.symbol === current}
                onPick={() => {
                  onPick(x.symbol);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  trade,
  here,
  onPick,
}: {
  trade: ActiveTrade;
  here: boolean;
  onPick: () => void;
}) {
  const t = useT();
  const p = t.terminal.positions;
  const long = trade.side === "long";
  return (
    <button
      onClick={onPick}
      title={p.open(trade.symbol)}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--pane-hover)] hover:text-[var(--pane-text)] ${
        here ? "text-[var(--pane-text)]" : "text-[var(--pane-text-2)]"
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-semibold">{trade.symbol}</span>
      {trade.status === "open" ? (
        <span className="rounded bg-[var(--pane-chip-faint)] px-1 text-[10px] text-[var(--pane-chip)]">
          {p.active}
        </span>
      ) : (
        <span className="rounded bg-[var(--pane-hover)] px-1 text-[10px] text-[var(--pane-muted)]">
          {p.waiting}
        </span>
      )}
      <span
        className="font-semibold"
        style={{ color: long ? "var(--pane-up)" : "var(--pane-down)" }}
      >
        {long ? p.long : p.short}
      </span>
      <span className="tabular-nums text-[var(--pane-muted)]">×{trade.leverage}</span>
      <Takes trade={trade} />
    </button>
  );
}

/**
 * Точки целей: закрашенная - цель взята.
 *
 * По числу целей самой сделки, а не всегда три: на маленькой позиции доля не
 * набирает минимального объёма заявки, и целей бывает две или одна.
 */
function Takes({ trade }: { trade: ActiveTrade }) {
  const t = useT();
  return (
    <span
      className="flex shrink-0 gap-1"
      title={t.terminal.positions.takes(trade.takesHit, trade.targets.length)}
    >
      {trade.targets.map((_, i) => {
        const taken = i < trade.takesHit;
        return (
          <span
            key={i}
            data-taken={taken}
            className="h-1.5 w-1.5 rounded-full border"
            style={
              taken
                ? { background: "var(--pane-up)", borderColor: "var(--pane-up)" }
                : { borderColor: "var(--pane-muted)" }
            }
          />
        );
      })}
    </span>
  );
}
