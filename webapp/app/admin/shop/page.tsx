"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Eye, EyeOff, ExternalLink, Coins, Loader2, ImageDown } from "lucide-react";
import { api, ShopItem, ShopItemInput, ShopOrder } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import { cardImage } from "@/lib/tvImage";
import ShopIcon, { ICON_NAMES } from "@/components/shop/ShopIcon";

type Tab = "items" | "orders";

const EMPTY: ShopItemInput = {
  title: "", description: "", price: 0, category: "indicator",
  section: "shop", icon: "Gift", link_url: "", image_url: "", requires_tv: false, is_active: true, sort_order: 0,
};

export default function AdminShop() {
  const token = useMentorToken();
  const [tab, setTab] = useState<Tab>("items");
  const [items, setItems] = useState<ShopItem[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<ShopItem | "new" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    Promise.all([
      api.shopAdminItems(token).then(setItems).catch(() => {}),
      api.shopAdminOrders(token).then(setOrders).catch(() => {}),
    ]).finally(() => setLoaded(true));
  }
  useEffect(load, [token]);

  const pendingCount = orders.filter((o) => o.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 text-white">Маркет NMNH</h1>
        {tab === "items" && (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { setRefreshing(true); try { await api.shopRefreshPreviews(token); load(); } finally { setRefreshing(false); } }}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm text-text-secondary transition hover:text-white disabled:opacity-50"
              title="Перетянуть обложки у всех товаров из их ссылок"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />} Обновить превью
            </button>
            <button onClick={() => setEditing("new")} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
              <Plus className="h-4 w-4" /> Новый товар
            </button>
          </div>
        )}
      </div>

      {/* Табы */}
      <div className="flex gap-2 border-b border-border">
        {([["items", "Товары"], ["orders", `Заказы${pendingCount ? ` · ${pendingCount}` : ""}`]] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative px-4 py-2.5 text-sm font-semibold transition ${tab === id ? "text-accent-cyan" : "text-text-muted hover:text-white"}`}
          >
            {label}
            {tab === id && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-accent-cyan" />}
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="skeleton h-64 w-full" />
      ) : tab === "items" ? (
        <ItemsTab items={items} onEdit={setEditing} token={token} onChange={load} />
      ) : (
        <OrdersTab orders={orders} token={token} onChange={load} />
      )}

      {editing && (
        <ItemEditor
          token={token}
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/* ───────────────── Товары ───────────────── */

function ItemsTab({ items, onEdit, token, onChange }: {
  items: ShopItem[]; onEdit: (i: ShopItem) => void; token: string; onChange: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  async function toggle(it: ShopItem) {
    setBusy(it.id);
    try { await api.shopAdminUpdate(token, it.id, { is_active: !it.is_active }); onChange(); }
    finally { setBusy(null); }
  }
  async function del(id: number) {
    setBusy(id); setConfirmDel(null);
    try { await api.shopAdminDelete(token, id); onChange(); }
    finally { setBusy(null); }
  }

  const groups: [string, ShopItem[]][] = [
    ["Покупка за NMNH", items.filter((i) => i.section === "shop")],
    ["Наш софт", items.filter((i) => i.section === "software")],
    ["Прочее", items.filter((i) => i.section !== "shop" && i.section !== "software")],
  ];

  return (
    <div className="space-y-6">
      {groups.map(([label, list]) => list.length === 0 ? null : (
        <div key={label} className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">{label}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {list.map((it) => (
              <div key={it.id} className={`flex items-start gap-3 rounded-xl border bg-bg-card/40 p-4 ${it.is_active ? "border-border" : "border-border/40 opacity-60"}`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-cyan/10 text-accent-cyan">
                  <ShopIcon name={it.icon} className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-white">{it.title}</p>
                    {it.price > 0 && (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-accent-gold">
                        <Coins className="h-3 w-3" />{it.price}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{it.description}</p>
                  {it.link_url && (
                    <a href={it.link_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-cyan hover:underline">
                      <ExternalLink className="h-3 w-3" /> {it.link_url.slice(0, 36)}…
                    </a>
                  )}
                  <div className="mt-2 flex items-center gap-1.5">
                    <button onClick={() => onEdit(it)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:text-white" title="Редактировать">
                      <Pencil className="h-3 w-3" /> Ред.
                    </button>
                    <button onClick={() => toggle(it)} disabled={busy === it.id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-text-secondary hover:text-white" title={it.is_active ? "Скрыть" : "Показать"}>
                      {it.is_active ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {it.is_active ? "Скрыть" : "Показать"}
                    </button>
                    {confirmDel === it.id ? (
                      <>
                        <button onClick={() => del(it.id)} disabled={busy === it.id} className="rounded-lg border border-danger/50 bg-danger/10 px-2 py-1 text-xs font-bold text-danger">Удалить?</button>
                        <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-border px-2 py-1 text-xs text-text-muted">Нет</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDel(it.id)} disabled={busy === it.id} className="flex h-6 w-6 items-center justify-center rounded-lg border border-border text-text-muted hover:border-danger/50 hover:text-danger" title="Удалить">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="text-center text-text-muted">Товаров пока нет.</p>}
    </div>
  );
}

/* ───────────────── Заказы ───────────────── */

function OrdersTab({ orders, token, onChange }: { orders: ShopOrder[]; token: string; onChange: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});

  async function resolve(id: number, action: "fulfill" | "reject") {
    setBusy(id);
    try {
      if (action === "fulfill") await api.shopAdminFulfill(token, id, note[id] || "");
      else await api.shopAdminReject(token, id, note[id] || "");
      onChange();
    } finally { setBusy(null); }
  }

  if (orders.length === 0) return <p className="text-center text-text-muted">Заказов пока нет.</p>;

  const badge: Record<string, string> = {
    pending: "badge-gold", fulfilled: "badge-success", rejected: "badge-danger",
  };
  const stLabel: Record<string, string> = {
    pending: "ожидает", fulfilled: "выполнен", rejected: "отклонён",
  };

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <div key={o.id} className="rounded-xl border border-border bg-bg-card/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">{o.item_title}</span>
                <span className="flex items-center gap-1 text-xs font-bold text-accent-gold"><Coins className="h-3 w-3" />{o.price}</span>
                <span className={badge[o.status] || "badge-muted"}>{stLabel[o.status] || o.status}</span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {o.student_username || "—"} · UID {o.student_uid || "—"} · {new Date(o.created_at).toLocaleString("ru")}
              </p>
              {o.contact && <p className="mt-0.5 text-xs text-accent-cyan">Контакт: {o.contact}</p>}
              {o.mentor_note && <p className="mt-0.5 text-xs text-text-secondary">Заметка: {o.mentor_note}</p>}
            </div>
            {o.status === "pending" && (
              <div className="flex flex-col items-end gap-2">
                <input
                  value={note[o.id] || ""}
                  onChange={(e) => setNote((p) => ({ ...p, [o.id]: e.target.value }))}
                  placeholder="Комментарий / ссылка для ученика"
                  className="w-56 rounded-lg border border-border bg-bg-deep px-2.5 py-1.5 text-xs text-white outline-none focus:border-accent-cyan/50"
                />
                <div className="flex gap-2">
                  <button onClick={() => resolve(o.id, "fulfill")} disabled={busy === o.id} className="flex items-center gap-1 rounded-lg border border-success/50 bg-success/10 px-3 py-1.5 text-xs font-bold text-success hover:bg-success/20">
                    {busy === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Выполнить
                  </button>
                  <button onClick={() => resolve(o.id, "reject")} disabled={busy === o.id} className="flex items-center gap-1 rounded-lg border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger/20">
                    <X className="h-3 w-3" /> Отклонить
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────── Редактор товара ───────────────── */

function ItemEditor({ token, item, onClose, onSaved }: {
  token: string; item: ShopItem | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<ShopItemInput>(item ? {
    title: item.title, description: item.description, price: item.price, category: item.category,
    section: item.section, icon: item.icon, link_url: item.link_url, image_url: item.image_url,
    requires_tv: item.requires_tv, is_active: item.is_active, sort_order: item.sort_order,
  } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  function set<K extends keyof ShopItemInput>(k: K, v: ShopItemInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Подтянуть картинку из ссылки (og:image / TradingView snapshot)
  async function pullPreview(auto = false) {
    const link = (form.link_url || "").trim();
    if (!link) return;
    if (auto && form.image_url) return; // не перетирать вручную заданную картинку
    setPulling(true); setPullMsg(null);
    try {
      const r = await api.shopLinkPreview(token, link);
      if (r.image) { setForm((f) => ({ ...f, image_url: r.image! })); setPullMsg(null); }
      else setPullMsg("Картинку из ссылки вытащить не удалось — вставьте URL картинки вручную.");
    } catch {
      setPullMsg("Не удалось получить превью.");
    } finally { setPulling(false); }
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      if (item) await api.shopAdminUpdate(token, item.id, form);
      else await api.shopAdminCreate(token, form);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-bg-panel p-6 max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white">{item ? "Редактировать товар" : "Новый товар"}</h3>

        <div className="mt-4 space-y-3">
          <Field label="Название">
            <input value={form.title} onChange={(e) => set("title", e.target.value)} className="input" placeholder="Подписка на индикатор — 1 месяц" />
          </Field>
          <Field label="Описание">
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} className="input resize-none" placeholder="Что входит" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Цена (NMNH, 0 = витрина)">
              <input type="number" min={0} value={form.price} onChange={(e) => set("price", Number(e.target.value))} className="input" />
            </Field>
            <Field label="Порядок">
              <input type="number" value={form.sort_order} onChange={(e) => set("sort_order", Number(e.target.value))} className="input" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Раздел">
              <select value={form.section} onChange={(e) => set("section", e.target.value)} className="input">
                <option value="shop">Покупка за NMNH</option>
                <option value="software">Наш софт</option>
              </select>
            </Field>
            <Field label="Категория">
              <input value={form.category} onChange={(e) => set("category", e.target.value)} className="input" placeholder="indicator / mentorship / ai…" />
            </Field>
          </div>
          <Field label="Иконка">
            <select value={form.icon} onChange={(e) => set("icon", e.target.value)} className="input">
              {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Ссылка (видна в карточке)">
            <input
              value={form.link_url}
              onChange={(e) => set("link_url", e.target.value)}
              onBlur={() => pullPreview(true)}
              className="input"
              placeholder="https://tradingview.com/script/…"
            />
          </Field>
          <Field label="Картинка / скрин (URL — показывается в карточке)">
            <div className="flex gap-2">
              <input value={form.image_url} onChange={(e) => set("image_url", e.target.value)} className="input" placeholder="https://…/preview.png" />
              <button
                type="button"
                onClick={() => pullPreview(false)}
                disabled={pulling || !form.link_url?.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-accent-cyan/40 bg-accent-cyan/10 px-3 text-xs font-bold text-accent-cyan transition hover:bg-accent-cyan/20 disabled:opacity-50"
                title="Вытащить картинку из ссылки"
              >
                {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}
                Из ссылки
              </button>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              Картинка тянется из ссылки автоматически (og:image / снапшот TradingView). Можно вставить URL картинки вручную.
            </p>
            {pullMsg && <p className="mt-1 text-[11px] text-accent-gold">{pullMsg}</p>}
          </Field>
          {cardImage(form.image_url, form.link_url) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardImage(form.image_url, form.link_url)!} alt="превью" className="h-32 w-full rounded-xl border border-border object-cover" />
          )}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.requires_tv} onChange={(e) => set("requires_tv", e.target.checked)} className="h-4 w-4 accent-accent-gold" />
            Требовать ник TradingView при покупке
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 accent-accent-cyan" />
            Активен (виден ученикам)
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm text-text-muted hover:text-white">Отмена</button>
          <button onClick={save} disabled={busy || !form.title.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-cyan px-4 py-2.5 text-sm font-bold text-bg hover:bg-accent-cyan/90 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-text-muted">{label}</span>
      {children}
    </label>
  );
}
