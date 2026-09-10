"use client";

// Что уже куплено, откуда пришли монеты и что с заказами - одной панелью с
// вкладками. Три отдельные панели столбиком уводили баланс под сгиб экрана.

import { useState } from "react";
import { Check, Clock, X } from "lucide-react";
import type { CoinTx, Entitlement, ShopOrder } from "@/lib/api";
import { useIntlLocale, useT } from "@/lib/i18n";
import { rewardLabel } from "@/lib/rewardLabel";
import { CHIP, CHIP_OFF, CHIP_ON, NUM } from "@/components/app/Pane";

type Tab = "access" | "history" | "orders";
const TABS: Tab[] = ["access", "history", "orders"];

/** Сколько последних начислений показываем. Полная история - в аналитике. */
const HISTORY_ROWS = 15;

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
  const date = (iso: string) => new Date(iso).toLocaleDateString(numbers, { day: "numeric", month: "short" });
  const count: Record<Tab, number> = { access: owned.length, history: history.length, orders: orders.length };

  const empty = (text: string) => <p className="px-3 py-4 text-center text-[11px] text-[var(--pane-muted)]">{text}</p>;

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

      <div className="max-h-[320px] overflow-y-auto">
        {tab === "access" &&
          (owned.length === 0 ? (
            empty(t.shop.accessEmpty)
          ) : (
            <ul>
              {owned.map((one) => (
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
          ))}

        {tab === "history" &&
          (history.length === 0 ? (
            empty(t.shop.historyEmpty)
          ) : (
            <ul>
              {history.slice(0, HISTORY_ROWS).map((tx) => (
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
          ))}

        {tab === "orders" &&
          (orders.length === 0 ? (
            empty(t.shop.ordersEmpty)
          ) : (
            <ul>
              {orders.map((o) => {
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
          ))}
      </div>
    </section>
  );
}
