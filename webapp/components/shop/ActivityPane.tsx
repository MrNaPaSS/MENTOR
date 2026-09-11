"use client";

// Что уже куплено, откуда пришли монеты и что с заказами - одной панелью с
// вкладками. Три отдельные панели столбиком уводили баланс под сгиб экрана.
//
// В панели - три последние записи, не больше. Список рос вместе с покупками
// и отодвигал всё, что стоит под ним; целиком он открывается окном по кнопке.

import { useEffect, useState } from "react";
import { Check, ChevronRight, Clock, X } from "lucide-react";
import type { CoinTx, Entitlement, ShopOrder } from "@/lib/api";
import { useIntlLocale, useT } from "@/lib/i18n";
import { rewardLabel } from "@/lib/rewardLabel";
import { CHIP, CHIP_OFF, CHIP_ON, NUM, PaneScope } from "@/components/app/Pane";

type Tab = "access" | "history" | "orders";
const TABS: Tab[] = ["access", "history", "orders"];

/** Сколько записей видно в самой панели. Остальное - в окне. */
const SHOWN = 3;

const STATUS: Record<string, { key: "pending" | "fulfilled" | "rejected"; color: string; icon: typeof Check }> = {
  pending: { key: "pending", color: "var(--pane-gold)", icon: Clock },
  fulfilled: { key: "fulfilled", color: "var(--pane-up)", icon: Check },
  rejected: { key: "rejected", color: "var(--pane-down)", icon: X },
};

export default function ActivityPane({
  owned,
  history,
  orders,
}: {
  owned: Entitlement[];
  history: CoinTx[];
  orders: ShopOrder[];
}) {
  const t = useT();
  const numbers = useIntlLocale();
  const [tab, setTab] = useState<Tab>("access");
  const [open, setOpen] = useState(false);
  const date = (iso: string) => new Date(iso).toLocaleDateString(numbers, { day: "numeric", month: "short" });

  // Свежее - первым. Доступы сервер отдаёт в порядке покупки, история и
  // заказы уже идут от новых к старым.
  const lists = {
    access: [...owned].reverse(),
    history,
    orders,
  };
  const count: Record<Tab, number> = {
    access: lists.access.length,
    history: lists.history.length,
    orders: lists.orders.length,
  };

  const empty = (text: string) => <p className="px-3 py-4 text-center text-[11px] text-[var(--pane-muted)]">{text}</p>;

  const accessRows = (rows: Entitlement[]) => (
    <ul>
      {rows.map((one) => (
        <li
          key={one.feature}
          className="flex items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-2 text-[11px] last:border-b-0"
        >
          <span className="min-w-0 truncate text-[var(--pane-text)]">
            {t.shop.features[one.feature] ?? one.feature}
          </span>
          <span className="shrink-0 text-[var(--pane-up)]">
            {one.permanent
              ? t.shop.forever
              : one.charges > 0
                ? t.shop.chargesLeft(one.charges)
                : one.expires_at
                  ? t.shop.until(date(one.expires_at))
                  : ""}
          </span>
        </li>
      ))}
    </ul>
  );

  const historyRows = (rows: CoinTx[]) => (
    <ul>
      {rows.map((tx) => (
        <li
          key={tx.id}
          className="flex items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-1.5 text-[11px] last:border-b-0"
        >
          <span className="min-w-0">
            <span className="block truncate text-[var(--pane-text)]">{rewardLabel(tx, t)}</span>
            <span className="text-[10px] text-[var(--pane-muted)]">{date(tx.created_at)}</span>
          </span>
          <span
            className={`${NUM} shrink-0`}
            style={{
              color: tx.amount > 0 ? "var(--pane-gold)" : tx.amount < 0 ? "var(--pane-down)" : "var(--pane-muted)",
            }}
          >
            {tx.amount > 0 ? "+" : tx.amount < 0 ? "−" : ""}
            {Math.abs(tx.amount).toLocaleString(numbers)}
          </span>
        </li>
      ))}
    </ul>
  );

  const orderRows = (rows: ShopOrder[]) => (
    <ul>
      {rows.map((o) => {
        const st = STATUS[o.status] ?? STATUS.pending;
        const Icon = st.icon;
        return (
          <li key={o.id} className="border-b border-[var(--pane-border)] px-3 py-2 text-[11px] last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-semibold text-[var(--pane-text)]">{o.item_title}</span>
              <span className="flex shrink-0 items-center gap-1" style={{ color: st.color }}>
                <Icon className="h-3 w-3" />
                {t.shop.status[st.key]}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-[var(--pane-muted)]">
              {date(o.created_at)} · {o.price.toLocaleString(numbers)} NMNH
              {o.mentor_note && ` · ${o.mentor_note}`}
            </p>
          </li>
        );
      })}
    </ul>
  );

  /** Список вкладки: в панели - первые три, в окне - весь. */
  function body(which: Tab, limit?: number) {
    if (which === "access") {
      return count.access === 0 ? empty(t.shop.accessEmpty) : accessRows(lists.access.slice(0, limit));
    }
    if (which === "history") {
      return count.history === 0 ? empty(t.shop.historyEmpty) : historyRows(lists.history.slice(0, limit));
    }
    return count.orders === 0 ? empty(t.shop.ordersEmpty) : orderRows(lists.orders.slice(0, limit));
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <header className="flex items-center gap-1 border-b border-[var(--pane-border)] px-2 py-1.5">
        {TABS.map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`${CHIP} ${tab === key ? CHIP_ON : CHIP_OFF}`}>
            {t.shop.activity[key]}
            {count[key] > 0 && <span className="ml-1 font-mono text-[9px] opacity-60">{count[key]}</span>}
          </button>
        ))}
      </header>

      {body(tab, SHOWN)}

      {count[tab] > SHOWN && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1 border-t border-[var(--pane-border)] px-3 py-2 text-[11px] font-semibold text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
        >
          {t.shop.showAll(count[tab])}
          <ChevronRight className="h-3 w-3" />
        </button>
      )}

      {open && (
        <ListDialog title={t.shop.activity[tab]} onClose={() => setOpen(false)}>
          {body(tab)}
        </ListDialog>
      )}
    </section>
  );
}

/** Окно со всем списком вкладки - то же оформление, что у окна покупки. */
function ListDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <PaneScope className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-label={title}
        className="relative w-full max-w-md animate-dialog-in overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--pane-border)] px-4 py-2.5">
          <h2 className="text-[12px] font-semibold text-[var(--pane-text)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.cancel}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
      </section>
    </PaneScope>
  );
}
