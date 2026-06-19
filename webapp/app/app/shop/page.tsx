"use client";

import { useEffect, useState } from "react";
import { Coins, ExternalLink, ShoppingBag, Check, Clock, X, Loader2 } from "lucide-react";
import { api, ShopItem, ShopOrder, CoinsBalance } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { cardImage } from "@/lib/tvImage";
import ShopIcon from "@/components/shop/ShopIcon";
import CardHero from "@/components/shop/CardHero";

const STATUS: Record<string, { label: string; cls: string; icon: typeof Check }> = {
  pending:   { label: "Ожидает выдачи", cls: "text-accent-gold border-accent-gold/40 bg-accent-gold/10", icon: Clock },
  fulfilled: { label: "Выполнен",       cls: "text-success border-success/40 bg-success/10",            icon: Check },
  rejected:  { label: "Отклонён (возврат)", cls: "text-danger border-danger/40 bg-danger/10",           icon: X },
};

export default function ShopPage() {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload(token: string) {
    api.shopItems(token).then(setItems).catch(() => {});
    api.shopMyOrders(token).then(setOrders).catch(() => {});
    api.coins(token).then((c: CoinsBalance) => setBalance(c.balance)).catch(() => {});
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    Promise.all([
      api.shopItems(token).then(setItems).catch(() => {}),
      api.shopMyOrders(token).then(setOrders).catch(() => {}),
      api.coins(token).then((c: CoinsBalance) => setBalance(c.balance)).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }, []);

  async function confirmBuy() {
    const token = getAccessToken();
    if (!token || !buying) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api.shopBuy(token, buying.id, contact.trim());
      setOrders((prev) => [order, ...prev]);
      setBalance((b) => (b === null ? b : b - buying.price));
      window.dispatchEvent(new CustomEvent("nmnh-coins-updated", { detail: { balance: (balance ?? 0) - buying.price } }));
      setBuying(null);
      setContact("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка покупки");
    } finally {
      setBusy(false);
    }
  }

  const shopItems = items.filter((i) => i.section === "shop");
  const softwareItems = items.filter((i) => i.section === "software");

  if (!loaded) {
    return <div className="space-y-4"><div className="skeleton h-10 w-48" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <div key={i} className="skeleton h-44 w-full rounded-2xl" />)}</div></div>;
  }

  return (
    <div className="space-y-10">
      {/* Заголовок + баланс */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <ShoppingBag className="h-6 w-6 text-accent-gold" /> Маркет NMNH
          </h1>
          <p className="mt-1 text-sm text-text-muted">Трать монеты NMNH на подписки, менторство и доступ к софту.</p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-accent-gold/30 bg-accent-gold/10 px-4 py-2.5">
          <Coins className="h-5 w-5 text-accent-gold" />
          <span className="font-mono text-xl font-bold text-accent-gold tabular">{(balance ?? 0).toLocaleString("ru")}</span>
          <span className="text-[10px] font-bold text-accent-gold/60">NMNH</span>
        </div>
      </div>

      {/* ── Покупка за монеты ── */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">Купить за NMNH</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shopItems.map((it) => {
            const affordable = (balance ?? 0) >= it.price;
            const img = cardImage(it.image_url, it.link_url);
            return (
              <div
                key={it.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-bg-card/80 to-bg-card/20 shadow-[0_4px_24px_-10px_rgba(0,0,0,0.6)] transition duration-300 hover:-translate-y-1 hover:border-accent-gold/40 hover:shadow-[0_16px_44px_-14px_rgba(255,200,0,0.28)]"
              >
                {/* Hero */}
                <CardHero image={img} icon={it.icon} accent="gold">
                  <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-accent-gold/30 bg-black/45 px-3 py-1.5 backdrop-blur-md">
                    <Coins className="h-3.5 w-3.5 text-accent-gold" />
                    <span className="font-mono text-sm font-bold text-accent-gold">{it.price.toLocaleString("ru")}</span>
                  </div>
                  {img && (
                    <div className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/45 text-accent-gold backdrop-blur-md">
                      <ShopIcon name={it.icon} className="h-4 w-4" />
                    </div>
                  )}
                </CardHero>
                {/* Body */}
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="font-semibold leading-snug text-white">{it.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-muted line-clamp-3">{it.description}</p>
                  {it.link_url && (
                    <a href={it.link_url} target="_blank" rel="noopener noreferrer"
                       className="mt-3 inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-cyan transition hover:gap-1.5 hover:underline">
                      <ExternalLink className="h-3 w-3" /> Подробнее
                    </a>
                  )}
                  <button
                    onClick={() => { setBuying(it); setError(null); }}
                    disabled={!affordable}
                    className={`mt-4 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${
                      affordable
                        ? "bg-gradient-to-r from-accent-gold to-amber-400 text-bg shadow-[0_6px_18px_-6px_rgba(255,200,0,0.6)] hover:shadow-[0_8px_24px_-6px_rgba(255,200,0,0.8)]"
                        : "cursor-not-allowed border border-white/10 bg-white/[0.03] text-text-muted"
                    }`}
                  >
                    {affordable ? <><Coins className="h-4 w-4" /> Купить</> : "Недостаточно монет"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {shopItems.length === 0 && <p className="text-sm text-text-muted">Товары скоро появятся.</p>}
      </section>

      {/* ── Наш софт (витрина) ── */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">Наш софт</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {softwareItems.map((it) => {
            const img = cardImage(it.image_url, it.link_url);
            return (
            <div key={it.id} className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-bg-card/80 to-bg-card/20 shadow-[0_4px_24px_-10px_rgba(0,0,0,0.6)] transition duration-300 hover:-translate-y-1 hover:border-accent-cyan/40 hover:shadow-[0_16px_44px_-14px_rgba(10,255,224,0.22)]">
              {/* Hero */}
              <CardHero image={img} icon={it.icon} accent="cyan">
                {it.price > 0 && (
                  <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-accent-gold/30 bg-black/45 px-3 py-1.5 backdrop-blur-md">
                    <Coins className="h-3.5 w-3.5 text-accent-gold" />
                    <span className="font-mono text-sm font-bold text-accent-gold">{it.price.toLocaleString("ru")}</span>
                  </div>
                )}
                {img && (
                  <div className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/45 text-accent-cyan backdrop-blur-md">
                    <ShopIcon name={it.icon} className="h-4 w-4" />
                  </div>
                )}
              </CardHero>
              {/* Body */}
              <div className="flex flex-1 flex-col p-5">
                <h3 className="font-semibold leading-snug text-white">{it.title}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-muted line-clamp-3">{it.description}</p>
                {it.link_url ? (
                  <a href={it.link_url} target="_blank" rel="noopener noreferrer"
                     className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl border border-accent-cyan/40 bg-accent-cyan/[0.08] px-4 py-3 text-sm font-bold text-accent-cyan transition hover:bg-accent-cyan/20">
                    <ExternalLink className="h-4 w-4" /> Открыть
                  </a>
                ) : (
                  <span className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-center text-sm text-text-muted">Скоро</span>
                )}
              </div>
            </div>
            );
          })}
        </div>
        {softwareItems.length === 0 && <p className="text-sm text-text-muted">Раздел наполняется.</p>}
      </section>

      {/* ── Мои заказы ── */}
      {orders.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-muted">Мои заказы</h2>
          <div className="space-y-2">
            {orders.map((o) => {
              const st = STATUS[o.status] || STATUS.pending;
              const StIcon = st.icon;
              return (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-card/40 px-4 py-3">
                  <div>
                    <p className="font-semibold text-white">{o.item_title}</p>
                    <p className="text-xs text-text-muted">
                      {new Date(o.created_at).toLocaleString("ru")} · {o.price.toLocaleString("ru")} NMNH
                      {o.mentor_note && ` · ${o.mentor_note}`}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${st.cls}`}>
                    <StIcon className="h-3.5 w-3.5" /> {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Модал подтверждения покупки ── */}
      {buying && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !busy && setBuying(null)}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-bg-panel p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">Подтвердить покупку</h3>
            <p className="mt-2 text-sm text-text-muted">
              <span className="font-semibold text-white">{buying.title}</span> за{" "}
              <span className="font-mono font-bold text-accent-gold">{buying.price.toLocaleString("ru")} NMNH</span>.
              Монеты спишутся сразу, ментор выдаст доступ вручную.
            </p>
            <label className="mt-4 block text-xs font-semibold text-text-muted">
              {buying.requires_tv ? "Ваш ник TradingView (обязательно для выдачи доступа)" : "Контакт для связи (Telegram / email) — необязательно"}
            </label>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={buying.requires_tv ? "Ваш username на TradingView" : "@username"}
              className="mt-1.5 w-full rounded-xl border border-border bg-bg-deep px-3 py-2.5 text-sm text-white outline-none focus:border-accent-gold/50"
            />
            {buying.requires_tv && !contact.trim() && (
              <p className="mt-1.5 text-xs text-text-muted">Доступ к индикатору выдаётся на этот аккаунт TradingView.</p>
            )}
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button onClick={() => setBuying(null)} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm text-text-muted transition hover:text-white">
                Отмена
              </button>
              <button onClick={confirmBuy} disabled={busy || (buying.requires_tv && !contact.trim())} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-gold px-4 py-2.5 text-sm font-bold text-bg transition hover:bg-accent-gold/90 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                {busy ? "Покупка…" : "Купить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
