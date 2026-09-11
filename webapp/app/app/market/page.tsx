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
// вообще, где сегодня работать, что делают крупные, как выглядит рынок целиком
// и чего ждать по календарю.

import { useT } from "@/lib/i18n";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Building2,
  CalendarDays,
  Map as MapIcon,
  Search,
} from "lucide-react";
import { useTerminalTheme } from "@/lib/terminalTheme";
import { PaneHead, PaneScope } from "@/components/app/Pane";
import { useInView } from "@/lib/useInView";
import FearGreedPane from "@/components/market/FearGreedPane";
import FundingPane from "@/components/market/FundingPane";
import GlobalStrip from "@/components/market/GlobalStrip";
import MarketScreener from "@/components/market/MarketScreener";
import BitcoinPane from "@/components/market/BitcoinPane";
import TrendingPane from "@/components/market/TrendingPane";
import PulsePromo from "@/components/market/PulsePromo";
import { MARKET_SECTION_EVENT, sectionFromHash } from "@/lib/marketSection";

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

/**
 * Обёртка над встраиваемым скриптом TradingView.
 *
 * Тему он берёт один раз - из настроек, с которыми его завели, - поэтому при
 * смене темы виджет пересобирается целиком. Фон задаём цветом панели: своей
 * рамки чужой скрипт не рисует, и любое расхождение читается швом.
 */
function TvWidget({
  scriptName,
  config,
  height = 600,
}: {
  scriptName: string;
  config: Record<string, unknown>;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const configKey = JSON.stringify(config);
  const theme = useTerminalTheme();
  // Виджет собирается, когда до него долистали. Четыре чужих виджета на одной
  // странице тянули свои скрипты и кадры разом - и все вместе отнимали канал у
  // того единственного, на который человек смотрел.
  const seen = useInView(ref);

  useEffect(() => {
    const el = ref.current;
    if (!el || !seen) return;
    el.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    el.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.src = `https://s3.tradingview.com/external-embedding/${scriptName}`;
    script.async = true;
    script.innerHTML = JSON.stringify({
      ...config,
      width: "100%",
      height,
      colorTheme: theme,
      locale: "ru",
      isTransparent: false,
      // Тот же цвет, что у панели вокруг: #181a20 тёмная, белая светлая.
      backgroundColor: theme === "light" ? "#ffffff" : "#181a20",
    });
    el.appendChild(script);

    return () => {
      if (el) el.innerHTML = "";
    };
    // Тема в зависимостях: сменили её - виджет пересобирается. Своего способа
    // перекраситься на лету у него нет.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptName, configKey, height, theme, seen]);

  return (
    <div
      ref={ref}
      className="tradingview-widget-container"
      style={{ height, overflow: "hidden", scrollbarWidth: "none" }}
    />
  );
}

/** Панель под чужой виджет: та же рамка и шапка, что у своих показателей. */
function WidgetPane({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--pane-border)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-[12px] font-semibold text-[var(--pane-text)]">{title}</h2>
          <p className="mt-0.5 truncate text-[10px] text-[var(--pane-muted)]">{hint}</p>
        </div>
        <span
          className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--pane-muted)]"
          title={t.market.tvNote}
        >
          TradingView
        </span>
      </header>
      {children}
    </section>
  );
}

// ── Вкладки ───────────────────────────────────────────────────────────────────

type Section = "pulse" | "screener" | "smart" | "maps" | "calendar";

// Подписи и подсказки вкладок - в словаре, здесь порядок и картинки.
const TABS: { key: Section; icon: React.ReactNode }[] = [
  { key: "pulse", icon: <Activity className="h-3.5 w-3.5" /> },
  { key: "screener", icon: <Search className="h-3.5 w-3.5" /> },
  { key: "smart", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "maps", icon: <MapIcon className="h-3.5 w-3.5" /> },
  { key: "calendar", icon: <CalendarDays className="h-3.5 w-3.5" /> },
];

// ── Пульс ─────────────────────────────────────────────────────────────────────

// Раскладка по макету: сверху настроение, деньги за позиции и то, о чём
// говорят; снизу цена биткоина со свечами, его сеть под баннером и колонка
// оформления. На среднем экране - по две панели в ряд, на узком - столбиком.
function PulseSection() {
  const t = useT();
  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
      <FearGreedPane className="xl:col-span-5" />
      <FundingPane className="xl:col-span-4" />
      <TrendingPane className="xl:col-span-3" />
      <BitcoinPane part="price" className="xl:col-span-5" />
      <div className="flex flex-col gap-3 xl:col-span-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/art/market/bitcoin-leads.webp"
          alt={t.market.promo.bitcoinAlt}
          className="w-full rounded-xl border border-[var(--pane-border)] object-cover"
        />
        <BitcoinPane part="network" className="flex-1" />
      </div>
      <PulsePromo className="xl:col-span-4" />
    </div>
  );
}

// ── Карты ─────────────────────────────────────────────────────────────────────

function MapsSection() {
  const t = useT();
  return (
    <div className="space-y-3">
      <WidgetPane
        title={t.market.widgets.heatmap.title}
        hint={t.market.widgets.heatmap.hint}
      >
        <TvWidget
          scriptName="embed-widget-crypto-coins-heatmap.js"
          config={{
            dataSource: "Crypto",
            blockSize: "market_cap_calc",
            blockColor: "change",
            hasTopBar: false,
            isDataSetEnabled: false,
            isZoomEnabled: true,
            hasSymbolTooltip: true,
          }}
          height={520}
        />
      </WidgetPane>

      <div className="grid gap-3 lg:grid-cols-2">
        <WidgetPane title={t.market.widgets.forex.title} hint={t.market.widgets.forex.hint}>
          <TvWidget
            scriptName="embed-widget-forex-cross-rates.js"
            config={{ currencies: ["EUR", "USD", "JPY", "GBP", "CHF", "AUD", "CAD", "NZD"] }}
            height={400}
          />
        </WidgetPane>

        <WidgetPane title={t.market.widgets.etf.title} hint={t.market.widgets.etf.hint}>
          <TvWidget
            scriptName="embed-widget-etf-heatmap.js"
            config={{ dataSource: "AllUSEtf", blockSize: "aum", blockColor: "change", hasTopBar: false }}
            height={400}
          />
        </WidgetPane>
      </div>
    </div>
  );
}

// ── Календарь ─────────────────────────────────────────────────────────────────

function CalendarSection() {
  const t = useT();
  return (
    <WidgetPane
      title={t.market.widgets.calendar.title}
      hint={t.market.widgets.calendar.hint}
    >
      <TvWidget scriptName="embed-widget-events.js" config={{}} height={760} />
    </WidgetPane>
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
    const fromHash = sectionFromHash(window.location.hash, keys);
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
      {section === "smart" && <SmartMoney />}
      {section === "maps" && <MapsSection />}
      {section === "calendar" && <CalendarSection />}
    </PaneScope>
  );
}
