"use client";

// Раздел «Рынок»: то же рабочее место, только шире взгляд.
//
// Раньше он был стопкой чужих виджетов в четыре вкладки: каждый со своей
// рамкой, своим шрифтом и своим представлением о том, что такое тёмная тема.
// Между терминалом и этим разделом человек переходил как между двумя разными
// программами.
//
// Теперь всё, что мы умеем считать сами, считаем сами: настроение рынка,
// финансирование, сеть биткоина, скринер на живом потоке биржи. Чужое
// осталось там, где своего нет - тепловые карты и календарь событий, - и
// заведено в ту же рамку, что и остальное.
//
// Порядок вкладок отвечает на вопросы по мере их появления: что происходит
// вообще, что делают крупные, где сегодня работать, что об этом пишут, как
// выглядит рынок целиком и чего ждать по календарю.

import { useT } from "@/lib/i18n";
import CalendarPane from "@/components/market/CalendarPane";
import EtfFlowsPane from "@/components/market/EtfFlowsPane";
import HeatmapPane from "@/components/market/HeatmapPane";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  Activity,
  Building2,
  CalendarDays,
  Map as MapIcon,
  Newspaper,
  Search,
} from "lucide-react";
import { PaneHead, PaneScope } from "@/components/app/Pane";
import { useFitHeight } from "@/lib/useFitHeight";
import FearGreedPane from "@/components/market/FearGreedPane";
import FundingPane from "@/components/market/FundingPane";
import GlobalStrip from "@/components/market/GlobalStrip";
import MarketScreener from "@/components/market/MarketScreener";
import CryptoNewsPane from "@/components/market/CryptoNewsPane";
import BitcoinPane from "@/components/market/BitcoinPane";
import TrendingPane from "@/components/market/TrendingPane";
import PulsePromo from "@/components/market/PulsePromo";
import { MARKET_SECTION_EVENT, sectionFromHash, takePendingSection } from "@/lib/marketSection";

const SmartMoney = dynamic(() => import("@/app/app/smartmoney/page"), {
  ssr: false,
  loading: () => (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)]"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  ),
});

// ── Чужой виджет в нашей рамке ───────────────────────────────────────────────

// ── Вкладки ───────────────────────────────────────────────────────────────────

type Section = "pulse" | "screener" | "news" | "smart" | "maps" | "calendar";

// Подписи и подсказки вкладок - в словаре, здесь порядок и картинки.
const TABS: { key: Section; icon: React.ReactNode }[] = [
  { key: "pulse", icon: <Activity className="h-3.5 w-3.5" /> },
  { key: "smart", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "screener", icon: <Search className="h-3.5 w-3.5" /> },
  { key: "news", icon: <Newspaper className="h-3.5 w-3.5" /> },
  { key: "maps", icon: <MapIcon className="h-3.5 w-3.5" /> },
  { key: "calendar", icon: <CalendarDays className="h-3.5 w-3.5" /> },
];

// ── Пульс ─────────────────────────────────────────────────────────────────────

// Раскладка по макету: сверху настроение, деньги за позиции и то, о чём
// говорят; снизу цена биткоина со свечами, его сеть под баннером и колонка
// оформления. С планшета в горизонтали (lg) - та же сетка, что на мониторе;
// уже - по две панели в ряд, на телефоне - столбиком.
function PulseSection() {
  const t = useT();
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-12">
      <FearGreedPane className="lg:col-span-5" />
      <FundingPane className="lg:col-span-4" />
      <TrendingPane className="lg:col-span-3" />
      <BitcoinPane part="price" className="lg:col-span-5" />
      <div className="flex flex-col gap-3 lg:col-span-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/art/market/bitcoin-leads.webp"
          alt={t.market.promo.bitcoinAlt}
          className="w-full rounded-xl border border-[var(--pane-border)] object-cover"
        />
        <BitcoinPane part="network" className="flex-1" />
      </div>
      <PulsePromo className="lg:col-span-4" />
    </div>
  );
}

// ── Карты ─────────────────────────────────────────────────────────────────────
//
// Раньше здесь стояли два встроенных скрипта TradingView: тепловая карта
// криптовалют и карта американских ETF. Первая носила чужой бренд и не слушала
// нашу тему, вторая показывала фондовый рынок США - для академии
// крипто-фьючерсов чужую тему. Теперь обе панели свои, и внешних скриптов на
// странице ученика не осталось.

/** Высота шапки панели, пока её не измерили: две строки текста и отступы. */
const PANE_HEAD = 46;

/** С этой ширины секция подгоняется под окно: планшет в горизонтали и шире. */
const TABLET_WIDE = 1024;

function MapsSection() {
  const t = useT();
  // Карты - последняя секция раздела, и она должна кончаться внизу окна:
  // тепловая карта с прокруткой страницы читается плохо, её смотрят целиком.
  // С 1024: планшет в горизонтали смотрит карты так же, как монитор, - рядом и
  // во всю высоту окна.
  const { ref, height, head, wide } = useFitHeight(420, TABLET_WIDE);
  // Пока шапку не измерили, берём ожидаемую: две строки текста и отступы.
  const headSize = head || PANE_HEAD;
  // Минус два: столько чужой виджет добавляет к заданной высоте своей рамкой,
  // и без этого запаса страница получала два пикселя прокрутки.
  const widget = Math.max(260, Math.round(height - headSize) - 2);

  return (
    <div ref={ref} className="grid gap-3 lg:grid-cols-3">
      <HeatmapPane className="lg:col-span-2" height={wide ? widget : 520} />
      <EtfFlowsPane height={wide ? widget : undefined} />
    </div>
  );
}

// ── Календарь ─────────────────────────────────────────────────────────────────

function CalendarSection() {
  // Календарь - последняя секция раздела, и она должна кончаться внизу окна:
  // события за неделю читают целиком, а не листая страницу.
  const { ref, height, head, wide } = useFitHeight(420, TABLET_WIDE);
  const body =Math.max(320, Math.round(height - (head || PANE_HEAD)) - 26);

  return (
    <div ref={ref}>
      <CalendarPane height={wide ? body : undefined} />
    </div>
  );
}

// ── Страница ──────────────────────────────────────────────────────────────────

export default function MarketPage() {
  const t = useT();
  const [section, setSection] = useState<Section>("pulse");

  // Вкладку открывают и извне: якорем адреса со страницы Smart Money и
  // событием с баннера внутри самого «Рынка».
  useEffect(() => {
    const keys = TABS.map((tab) => tab.key);
    const fromHash =
      sectionFromHash(window.location.hash, keys) ?? sectionFromHash(takePendingSection(), keys);
    if (fromHash) setSection(fromHash);
    const onSection = (e: Event) => {
      const next = sectionFromHash(String((e as CustomEvent<string>).detail ?? ""), keys);
      if (next) {
        setSection(next);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };
    window.addEventListener(MARKET_SECTION_EVENT, onSection);
    return () => window.removeEventListener(MARKET_SECTION_EVENT, onSection);
  }, []);
  const active = t.market.tabs[section];

  return (
    <PaneScope className="space-y-3">
      {/* Шапка раздела - общая для всех разделов кабинета: имя, строка о том,
          что открыто, и действия справа. */}
      {/* Вкладки - в строке названия, отдельными кнопками, выбранная золотом:
          раздел не тратит на них отдельную строку и помещается на экран. */}
      <PaneHead
        title={t.market.title}
        hint={active.hint}
        hintBelow
        nav={
          <nav className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            {TABS.map((tab) => {
              const on = section === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setSection(tab.key)}
                  title={t.market.tabs[tab.key].hint}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-semibold transition-colors duration-150 ease-out ${
                    on
                      ? "border-accent-gold/60 bg-[color:color-mix(in_srgb,var(--pane-gold)_12%,transparent)] text-[var(--pane-text)]"
                      : "border-[var(--pane-border)] bg-[var(--pane-bg)] text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
                  }`}
                >
                  {tab.icon}
                  {t.market.tabs[tab.key].label}
                </button>
              );
            })}
          </nav>
        }
      />

      <GlobalStrip />


      {section === "pulse" && <PulseSection />}
      {section === "screener" && <MarketScreener />}
      {section === "news" && <CryptoNewsPane />}
      {section === "smart" && <SmartMoney />}
      {section === "maps" && <MapsSection />}
      {section === "calendar" && <CalendarSection />}
    </PaneScope>
  );
}
