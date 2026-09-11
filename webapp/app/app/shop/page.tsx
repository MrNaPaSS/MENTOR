"use client";

// Маркет: на что тратить монеты NMNH.
//
// Собран так же, как достижения в аналитике: категории чипами со счётчиком,
// карточки с превью и цветом по тому, как продаётся товар. Первыми идут
// функции платформы - они включаются сразу после покупки, без ментора.
// Дальше оформление (рамки аватара с живым превью на своём аватаре),
// менторство и наш софт.
//
// Справа - баланс, ожидающие награды и до чего осталось накопить, а под ним
// купленное, история и заказы. «Как заработать» спрятано под кнопку: это
// справка, её читают один раз.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, Crown, LayoutGrid, Search, Shirt, Wrench, X, Zap, type LucideIcon } from "lucide-react";
import { api, API_URL, type CoinTx, type Profile, type ShopItem, type ShopOrder } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useT, useLocale } from "@/lib/i18n";
import { useCoins, COINS_EVENT } from "@/lib/useCoins";
import { announceEntitlements, useEntitlements } from "@/lib/entitlements";
import { itemTitle } from "@/lib/shopText";
import { frameOfFeature, RANK_FRAMES } from "@/lib/frames";
import { PROFILE_EVENT } from "@/lib/profileEvent";
import { PaneHead, PaneScope } from "@/components/app/Pane";
import FramedAvatar from "@/components/avatar/FramedAvatar";
import ShopCard from "@/components/shop/ShopCard";
import BalanceCard from "@/components/shop/BalanceCard";
import ActivityPane from "@/components/shop/ActivityPane";
import BuyDialog from "@/components/shop/BuyDialog";
import CommunityBanner from "@/components/shop/CommunityBanner";
import SoftPanel from "@/components/shop/SoftPanel";
import BrandStrip from "@/components/app/BrandStrip";

type Cat = "all" | "tools" | "features" | "frames" | "merch" | "software";
type Sort = "catalog" | "cheap" | "expensive";
type Group = Exclude<Cat, "all">;

const CATS: { id: Cat; icon: LucideIcon }[] = [
  { id: "all", icon: LayoutGrid },
  { id: "tools", icon: Wrench },
  { id: "features", icon: Zap },
  { id: "frames", icon: Crown },
  { id: "merch", icon: Shirt },
  { id: "software", icon: Cpu },
];

/**
 * Порядок групп во вкладке «Все»: то, что включается сразу, - первым. Рамки
 * - в самом низу: это оформление, а не инструмент, и пять карточек с
 * аватарами отодвигали мерч и софт за сгиб экрана.
 */
const ORDER: Record<Group, number> = { tools: 0, features: 1, merch: 2, software: 3, frames: 4 };

/**
 * Группа товара в маркете. null - товар в маркете не показывается.
 *
 * Менторство из маркета убрано: разбор и сопровождение продаёт сам ментор,
 * а не витрина за монеты. Такие товары остаются в админке - их можно
 * выключить или удалить там, - но ученику не видны.
 */
function catOf(item: ShopItem): Group | null {
  // Подписки на индикаторы TradingView - доступ к чужой площадке, а не наш
  // терминал: их место в «Нашем софте», рядом с остальными ссылками.
  if (item.section === "software" || item.category === "indicator") return "software";
  // Инструменты терминала - своим разделом и первыми: ими работают каждый
  // день, а не украшают профиль.
  if (item.section === "tools" || item.category === "tool") return "tools";
  if (item.category === "merch") return "merch";
  if (frameOfFeature(item.feature)) return "frames";
  if (item.feature) return "features";
  return null;
}

function groupOf(item: ShopItem): Group {
  return catOf(item) ?? "software";
}

/** Карточка рамки лидерборда: не товар, а место, показываем для мотивации. */
function rankItem(rank: number): ShopItem {
  return {
    id: -rank,
    title: "",
    description: "",
    price: 0,
    category: "frame",
    section: "shop",
    icon: "Crown",
    link_url: "",
    image_url: "",
    requires_tv: false,
    is_active: true,
    sort_order: 0,
  };
}

export default function ShopPage() {
  const t = useT();
  const locale = useLocale();
  const { coins, pendingTotal, pendingCount } = useCoins();
  const owned = useEntitlements();
  const balance = coins ?? 0;

  const [items, setItems] = useState<ShopItem[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [history, setHistory] = useState<CoinTx[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cat, setCat] = useState<Cat>("all");
  // Раздел можно открыть ссылкой: кнопка с замком в терминале ведёт прямо в
  // «Инструменты», а не на общую витрину. Адрес читаем после монтирования -
  // страница собирается статикой, и на сборке адреса нет.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("cat");
    if (CATS.some((one) => one.id === asked)) setCat(asked as Cat);
  }, []);
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("catalog");

  const loadHistory = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;
    api.coins(token).then((c) => setHistory(c.transactions ?? [])).catch(() => {});
  }, []);

  const loadProfile = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;
    api.profile(token).then(setProfile).catch(() => {});
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    Promise.all([
      api.shopItems(token).then(setItems).catch(() => {}),
      api.shopMyOrders(token).then(setOrders).catch(() => {}),
    ]).finally(() => setLoaded(true));
    loadHistory();
    loadProfile();
  }, [loadHistory, loadProfile]);

  // Монеты меняются снаружи страницы: забрали награды в шапке, начислила
  // академия. История должна показать это сразу, а не после перезагрузки.
  useEffect(() => {
    window.addEventListener(COINS_EVENT, loadHistory);
    return () => window.removeEventListener(COINS_EVENT, loadHistory);
  }, [loadHistory]);

  const me = {
    src: profile?.avatar_url ? `${API_URL}${profile.avatar_url}` : null,
    name: profile?.card_name || profile?.username || "N",
  };
  const equipped = profile?.avatar_frame ?? "";

  // Только то, что маркет показывает: менторство сюда не попадает вовсе.
  const shown = useMemo(() => items.filter((item) => catOf(item) !== null), [items]);

  const counts = useMemo(() => {
    const out: Record<Cat, number> = {
      all: shown.length, tools: 0, features: 0, frames: 0, merch: 0, software: 0,
    };
    for (const item of shown) out[groupOf(item)] += 1;
    return out;
  }, [shown]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (cat === "all" ? shown : shown.filter((item) => catOf(item) === cat)).filter(
      // Ищем по обоим языкам: название могли запомнить на любом.
      (item) =>
        !needle ||
        `${item.title} ${item.description} ${item.title_en ?? ""} ${item.description_en ?? ""}`
          .toLowerCase()
          .includes(needle),
    );
    // По каталогу: внутри группы - порядок каталога, между группами - наш.
    // По цене - без групп: сравнивают именно цены.
    return [...list].sort((a, b) =>
      sort === "cheap"
        ? a.price - b.price
        : sort === "expensive"
          ? b.price - a.price
          : ORDER[groupOf(a)] - ORDER[groupOf(b)] || a.sort_order - b.sort_order,
    );
  }, [shown, cat, query, sort]);

  // Главный продукт «Нашего софта» - самый дорогой из софта в каталоге.
  const featured = useMemo(
    () => shown.filter((item) => catOf(item) === "software" && item.price > 0).sort((a, b) => b.price - a.price)[0] ?? null,
    [shown],
  );

  // Ближайшая цель: самый дешёвый из видимых товаров, на который пока не
  // хватает. Спрятанный товар целью быть не может - к нему не дойти.
  const goal = useMemo(() => {
    const next = shown
      .filter((item) => item.price > balance)
      .filter((item) => !(item.feature && owned.find(item.feature)?.permanent))
      .sort((a, b) => a.price - b.price)[0];
    return next ? { title: itemTitle(next, locale), price: next.price } : null;
  }, [shown, balance, owned]);

  async function buy(item: ShopItem, contact: string) {
    const token = getAccessToken();
    if (!token) throw new Error(t.shop.buyError);
    const order = await api.shopBuy(token, item.id, contact);
    setOrders((prev) => [order, ...prev]);
    // Списание видно сразу и в шапке, и здесь: один источник числа.
    window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail: { balance: balance - item.price } }));
    if (item.feature) announceEntitlements();
    // Первая рамка надевается на сервере сама - профиль перечитываем.
    if (frameOfFeature(item.feature)) {
      loadProfile();
      window.dispatchEvent(new Event(PROFILE_EVENT));
    }
    const name = itemTitle(item, locale);
    setNote(item.feature ? t.shop.done(name) : t.shop.doneManual(name));
    setBuying(null);
  }

  async function equip(frame: string) {
    const token = getAccessToken();
    if (!token) return;
    try {
      await api.shopSetFrame(token, frame);
      setProfile((prev) => (prev ? { ...prev, avatar_frame: frame } : prev));
      window.dispatchEvent(new Event(PROFILE_EVENT));
    } catch (e) {
      setNote(e instanceof Error ? e.message : t.shop.buyError);
    }
  }

  const buyingFrame = buying ? frameOfFeature(buying.feature) : null;

  // Разделы, поиск и порядок - в строке заголовка, правее описания. Отдельной
  // строкой над витриной они сдвигали карточки вниз, и витрина начиналась
  // ниже баланса справа; теперь обе колонки стоят от одной линии.
  const toolbar = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="no-scrollbar flex min-w-0 gap-1.5 overflow-x-auto">
        {CATS.map(({ id, icon: Icon }) => {
          const on = cat === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setCat(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors duration-150 ease-out ${
                on
                  ? "border-accent-gold/50 bg-accent-gold/10 text-[var(--pane-gold)]"
                  : "border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
              }`}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {t.shop.cats[id]}
              <span className="font-mono text-[9px] opacity-60">
                {id === "frames" ? counts.frames + RANK_FRAMES.length : counts[id]}
              </span>
            </button>
          );
        })}
      </div>
      <label className="flex h-8 w-full items-center gap-1.5 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] px-2.5 sm:w-44">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--pane-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.shop.search}
          aria-label={t.shop.search}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--pane-text)] outline-none placeholder:text-[var(--pane-muted)]"
        />
      </label>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as Sort)}
        aria-label={t.shop.sort.label}
        className="h-8 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] px-2 text-[11px] text-[var(--pane-text)] outline-none"
      >
        {(["catalog", "cheap", "expensive"] as const).map((id) => (
          <option key={id} value={id}>
            {t.shop.sort[id]}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <PaneScope className="space-y-3">
      <PaneHead title={t.shop.title} hint={t.shop.hint} hintBelow nav={toolbar} />

      {note && (
        <div className="flex animate-fade-in items-center justify-between gap-3 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-up-faint)] px-3 py-2 text-[12px] text-[var(--pane-up)] motion-reduce:animate-none">
          <span>{note}</span>
          <button type="button" onClick={() => setNote(null)} aria-label={t.common.cancel}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          {!loaded ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-64 animate-pulse rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)]"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          ) : visible.length === 0 && (cat !== "frames" || query.trim()) ? (
            <p className="rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-10 text-center text-[11px] text-[var(--pane-muted)]">
              {query.trim() ? t.shop.nothingFound : t.shop.empty}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((item) => (
                <ShopCard
                  key={item.id}
                  item={item}
                  balance={balance}
                  access={item.feature ? owned.find(item.feature) : null}
                  me={me}
                  equipped={equipped}
                  onBuy={setBuying}
                  onEquip={equip}
                />
              ))}
              {cat === "frames" && !query.trim() &&
                RANK_FRAMES.map((_, i) => (
                  <ShopCard
                    key={`rank-${i + 1}`}
                    item={rankItem(i + 1)}
                    balance={balance}
                    access={null}
                    me={me}
                    equipped={equipped}
                    rank={i + 1}
                    onBuy={setBuying}
                    onEquip={equip}
                  />
                ))}
            </div>
          )}
        </div>

        <aside className="space-y-3 lg:self-start">
          <BalanceCard balance={balance} pendingCount={pendingCount} pendingTotal={pendingTotal} goal={goal} />
          <ActivityPane
            owned={owned.list}
            history={history}
            // Заказ хранит название на момент покупки, по-русски. Если товар
            // ещё в каталоге - называем его на языке кабинета.
            orders={orders.map((o) => {
              const item = items.find((one) => one.id === o.item_id);
              return item ? { ...o, item_title: itemTitle(item, locale) } : o;
            })}
          />
          <CommunityBanner />
          <SoftPanel
            featured={featured}
            image="/art/brand/laptop.webp"
            onOpen={setBuying}
            onPick={(next) => {
              setCat(next);
              setQuery("");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
          <BrandStrip />
        </aside>
      </div>

      {buying && (
        <BuyDialog
          item={buying}
          balance={balance}
          preview={
            buyingFrame ? (
              <div className="flex items-center justify-center gap-6 py-2">
                <FramedAvatar src={me.src} name={me.name} size={52} frame={buyingFrame} />
                <FramedAvatar src={me.src} name={me.name} size={44} frame={buyingFrame} shape="square" radius={8} />
              </div>
            ) : null
          }
          onConfirm={(contact) => buy(buying, contact)}
          onClose={() => setBuying(null)}
        />
      )}
    </PaneScope>
  );
}
