"use client";

// Маркет: на что тратить монеты NMNH.
//
// Раньше это была витрина из больших карточек с обложками, собранная другими
// руками, чем остальной кабинет, и половину её занимали подписки на чужие
// индикаторы TradingView. Монеты зарабатываются в терминале - и тратиться
// должны на то, что делает терминал сильнее.
//
// Поэтому на первом месте функции платформы: они включаются сразу после
// покупки, без ментора. Дальше то, что выдаёт живой человек, и наш софт.
// Справа - сколько монет, откуда они приходят и что уже куплено.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Gift, X } from "lucide-react";
import { api, type CoinTx, type ShopItem, type ShopOrder } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useIntlLocale, useT } from "@/lib/i18n";
import { useCoins, COINS_EVENT } from "@/lib/useCoins";
import { announceEntitlements, useEntitlements } from "@/lib/entitlements";
import { openRewards } from "@/lib/rewards";
import { rewardLabel } from "@/lib/rewardLabel";
import { CHIP, CHIP_OFF, NUM, Pane, PaneHead, PaneScope } from "@/components/app/Pane";
import ShopRow from "@/components/shop/ShopRow";
import BuyDialog from "@/components/shop/BuyDialog";

type Tab = "features" | "people" | "software";
const TABS: Tab[] = ["features", "people", "software"];

const STATUS: Record<string, { key: "pending" | "fulfilled" | "rejected"; color: string; icon: typeof Check }> = {
  pending: { key: "pending", color: "var(--pane-gold)", icon: Clock },
  fulfilled: { key: "fulfilled", color: "var(--pane-up)", icon: Check },
  rejected: { key: "rejected", color: "var(--pane-down)", icon: X },
};

/** Сколько последних начислений показываем справа. Полная история - в аналитике. */
const HISTORY_ROWS = 12;

export default function ShopPage() {
  const t = useT();
  const numbers = useIntlLocale();
  const { coins, pendingTotal, pendingCount } = useCoins();
  const owned = useEntitlements();
  const balance = coins ?? 0;

  const [items, setItems] = useState<ShopItem[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [history, setHistory] = useState<CoinTx[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("features");
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;
    api.coins(token).then((c) => setHistory(c.transactions ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    Promise.all([
      api.shopItems(token).then(setItems).catch(() => {}),
      api.shopMyOrders(token).then(setOrders).catch(() => {}),
    ]).finally(() => setLoaded(true));
    loadHistory();
  }, [loadHistory]);

  // Монеты меняются снаружи страницы: забрали награды в шапке, начислила
  // академия. История должна показать это сразу, а не после перезагрузки.
  useEffect(() => {
    window.addEventListener(COINS_EVENT, loadHistory);
    return () => window.removeEventListener(COINS_EVENT, loadHistory);
  }, [loadHistory]);

  const groups = useMemo(() => {
    const shop = items.filter((i) => i.section === "shop");
    return {
      features: shop.filter((i) => i.feature),
      people: shop.filter((i) => !i.feature && i.category !== "indicator"),
      software: items.filter((i) => i.section === "software"),
      // Подписки на индикаторы TradingView - не наш терминал, а доступ к
      // чужой площадке. Они остаются, но строкой внизу «Нашего софта».
      indicators: shop.filter((i) => !i.feature && i.category === "indicator"),
    };
  }, [items]);

  async function buy(item: ShopItem, contact: string) {
    const token = getAccessToken();
    if (!token) throw new Error(t.shop.buyError);
    const order = await api.shopBuy(token, item.id, contact);
    setOrders((prev) => [order, ...prev]);
    // Списание видно сразу и в шапке, и здесь: один источник числа.
    window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail: { balance: balance - item.price } }));
    if (item.feature) announceEntitlements();
    setNote(item.feature ? t.shop.done(item.title) : t.shop.doneManual(item.title));
    setBuying(null);
  }

  const rows = tab === "software" ? groups.software : groups[tab];

  return (
    <PaneScope className="space-y-3">
      <PaneHead title={t.shop.title} hint={t.shop.hint}>
        <span className={`${NUM} text-[13px] font-semibold`} style={{ color: "var(--pane-gold)" }}>
          {balance.toLocaleString(numbers)} NMNH
        </span>
      </PaneHead>

      {note && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-up-faint)] px-3 py-2 text-[12px] text-[var(--pane-up)]">
          <span>{note}</span>
          <button type="button" onClick={() => setNote(null)} aria-label={t.common.cancel}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Каталог ── */}
        <div className="min-w-0 space-y-3">
          <nav className="no-scrollbar flex overflow-x-auto rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] p-0.5">
            {TABS.map((key) => {
              const on = tab === key;
              const count = key === "software" ? groups.software.length + groups.indicators.length : groups[key].length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  title={t.shop.tabHints[key]}
                  className="flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold transition-colors duration-150"
                  style={{
                    background: on ? "var(--pane-chip-faint)" : "transparent",
                    color: on ? "var(--pane-chip)" : "var(--pane-muted)",
                  }}
                >
                  {t.shop.tabs[key]}
                  <span className="font-mono text-[10px] opacity-60">{count}</span>
                </button>
              );
            })}
          </nav>

          <Pane title={t.shop.tabs[tab]} hint={t.shop.tabHints[tab]} body="p-0">
            {!loaded ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-md bg-[var(--pane-hover)]" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-[var(--pane-muted)]">{t.shop.empty}</p>
            ) : (
              <ul>
                {rows.map((item) => (
                  <ShopRow
                    key={item.id}
                    item={item}
                    balance={balance}
                    access={item.feature ? owned.find(item.feature) : null}
                    onBuy={setBuying}
                  />
                ))}
              </ul>
            )}
          </Pane>

          {tab === "software" && groups.indicators.length > 0 && (
            <Pane title={t.shop.indicatorsTitle} hint={t.shop.indicatorsHint} body="p-0">
              <ul>
                {groups.indicators.map((item) => (
                  <ShopRow key={item.id} item={item} balance={balance} access={null} onBuy={setBuying} />
                ))}
              </ul>
            </Pane>
          )}
        </div>

        {/* ── Монеты и купленное ── */}
        <aside className="space-y-3">
          <Pane title={t.shop.balance}>
            <div className={`${NUM} text-[22px] font-semibold`} style={{ color: "var(--pane-gold)" }}>
              {balance.toLocaleString(numbers)}
              <span className="ml-1.5 text-[11px] font-bold opacity-60">NMNH</span>
            </div>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={openRewards}
                className="mt-2 flex w-full items-center justify-between gap-2 rounded-md border border-[var(--pane-border)] px-2.5 py-1.5 text-[11px] transition-colors duration-150 ease-out hover:bg-[var(--pane-hover)]"
              >
                <span className="flex items-center gap-1.5 text-[var(--pane-text)]">
                  <Gift className="h-3.5 w-3.5" style={{ color: "var(--pane-gold)" }} />
                  {t.shop.waiting(pendingCount)}
                </span>
                <span className="font-semibold" style={{ color: "var(--pane-gold)" }}>
                  {t.shop.claim} +{pendingTotal.toLocaleString(numbers)}
                </span>
              </button>
            )}
            <div className="mt-3 border-t border-[var(--pane-border)] pt-2">
              <p className="text-[11px] font-semibold text-[var(--pane-text)]">{t.shop.earnTitle}</p>
              <ul className="mt-1 space-y-0.5">
                {t.shop.earnLines.map((line) => (
                  <li key={line} className="text-[11px] text-[var(--pane-muted)]">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </Pane>

          <Pane title={t.shop.accessTitle} body="p-0">
            {owned.list.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-[var(--pane-muted)]">{t.shop.accessEmpty}</p>
            ) : (
              <ul>
                {owned.list.map((one) => (
                  <li
                    key={one.feature}
                    className="flex items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-2 text-[11px] last:border-b-0"
                  >
                    <span className="text-[var(--pane-text)]">{t.shop.features[one.feature] ?? one.feature}</span>
                    <span className="text-[var(--pane-up)]">
                      {one.permanent
                        ? t.shop.forever
                        : one.charges > 0
                          ? t.shop.chargesLeft(one.charges)
                          : one.expires_at
                            ? t.shop.until(
                                new Date(one.expires_at).toLocaleDateString(numbers, {
                                  day: "numeric",
                                  month: "short",
                                }),
                              )
                            : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Pane>

          <Pane title={t.shop.historyTitle} body="p-0">
            {history.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-[var(--pane-muted)]">{t.shop.historyEmpty}</p>
            ) : (
              <ul>
                {history.slice(0, HISTORY_ROWS).map((tx) => (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-2 border-b border-[var(--pane-border)] px-3 py-1.5 text-[11px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-[var(--pane-text)]">{rewardLabel(tx, t)}</span>
                    <span
                      className={`${NUM} shrink-0`}
                      style={{
                        color:
                          tx.amount > 0 ? "var(--pane-gold)" : tx.amount < 0 ? "var(--pane-down)" : "var(--pane-muted)",
                      }}
                    >
                      {tx.amount > 0 ? "+" : tx.amount < 0 ? "−" : ""}
                      {Math.abs(tx.amount).toLocaleString(numbers)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Pane>

          {orders.length > 0 && (
            <Pane title={t.shop.ordersSection} body="p-0">
              <ul>
                {orders.map((o) => {
                  const st = STATUS[o.status] ?? STATUS.pending;
                  const Icon = st.icon;
                  return (
                    <li
                      key={o.id}
                      className="border-b border-[var(--pane-border)] px-3 py-2 text-[11px] last:border-b-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold text-[var(--pane-text)]">{o.item_title}</span>
                        <span className="flex shrink-0 items-center gap-1" style={{ color: st.color }}>
                          <Icon className="h-3 w-3" />
                          {t.shop.status[st.key]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-[var(--pane-muted)]">
                        {new Date(o.created_at).toLocaleDateString(numbers, { day: "numeric", month: "short" })} ·{" "}
                        {o.price.toLocaleString(numbers)} NMNH
                        {o.mentor_note && ` · ${o.mentor_note}`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Pane>
          )}

          <a href="/app/analytics" className={`${CHIP} ${CHIP_OFF} inline-block`}>
            {t.rewards.history}
          </a>
        </aside>
      </div>

      {buying && (
        <BuyDialog
          item={buying}
          balance={balance}
          onConfirm={(contact) => buy(buying, contact)}
          onClose={() => setBuying(null)}
        />
      )}
    </PaneScope>
  );
}
