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
import FearGreedPane from "@/components/market/FearGreedPane";
import ForexPane from "@/components/market/ForexPane";
import FundingPane from "@/components/market/FundingPane";
import GlobalStrip from "@/components/market/GlobalStrip";
import MarketScreener from "@/components/market/MarketScreener";
import OnChainPane from "@/components/market/OnChainPane";
import TrendingPane from "@/components/market/TrendingPane";

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
  }, [scriptName, configKey, height, theme]);

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
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)]">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--pane-border)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-[12px] font-semibold text-[var(--pane-text)]">{title}</h2>
          <p className="mt-0.5 truncate text-[10px] text-[var(--pane-muted)]">{hint}</p>
        </div>
        <span
          className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-[var(--pane-muted)]"
          title="Данные и рисование - TradingView"
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

const TABS: { key: Section; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "pulse", label: "Пульс", icon: <Activity className="h-3.5 w-3.5" />, hint: "Настроение рынка и деньги за позиции" },
  { key: "screener", label: "Скринер", icon: <Search className="h-3.5 w-3.5" />, hint: "Где сегодня работать" },
  { key: "smart", label: "Smart Money", icon: <Building2 className="h-3.5 w-3.5" />, hint: "Что делают крупные" },
  { key: "maps", label: "Карты", icon: <MapIcon className="h-3.5 w-3.5" />, hint: "Рынок целиком одной картинкой" },
  { key: "calendar", label: "Календарь", icon: <CalendarDays className="h-3.5 w-3.5" />, hint: "События, двигающие рынок" },
];

// ── Пульс ─────────────────────────────────────────────────────────────────────

function PulseSection() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <FearGreedPane />
      <FundingPane />
      <OnChainPane />
      <div className="grid gap-3">
        <TrendingPane />
        <ForexPane />
      </div>
    </div>
  );
}

// ── Карты ─────────────────────────────────────────────────────────────────────

function MapsSection() {
  return (
    <div className="space-y-3">
      <WidgetPane
        title="Тепловая карта криптовалют"
        hint="Размер - капитализация, цвет - изменение цены"
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
        <WidgetPane title="Валютные пары" hint="Кросс-курсы восьми основных валют">
          <TvWidget
            scriptName="embed-widget-forex-cross-rates.js"
            config={{ currencies: ["EUR", "USD", "JPY", "GBP", "CHF", "AUD", "CAD", "NZD"] }}
            height={400}
          />
        </WidgetPane>

        <WidgetPane title="Фонды ETF" hint="Размер - активы под управлением, цвет - день">
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
  return (
    <WidgetPane
      title="Экономический календарь"
      hint="Макроэкономические события: ставки, инфляция, занятость"
    >
      <TvWidget scriptName="embed-widget-events.js" config={{}} height={760} />
    </WidgetPane>
  );
}

// ── Страница ──────────────────────────────────────────────────────────────────

export default function MarketPage() {
  const [section, setSection] = useState<Section>("pulse");
  const pane = useTerminalTheme() === "light" ? "pane-light" : "pane-dark";
  const active = TABS.find((t) => t.key === section);

  return (
    <div className={`${pane} space-y-3`}>
      {/* Шапка раздела: имя и то, что сейчас открыто. */}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[15px] font-semibold uppercase tracking-[0.16em] text-[var(--pane-text)]">
          Рынок
        </h1>
        <p className="truncate text-[11px] text-[var(--pane-muted)]">{active?.hint}</p>
      </div>

      <GlobalStrip />

      {/* Вкладки сегментами, как переключатели в терминале. */}
      <nav className="no-scrollbar flex overflow-x-auto rounded-lg border border-[var(--pane-border)] bg-[var(--pane-bg)] p-0.5">
        {TABS.map((t) => {
          const on = section === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              title={t.hint}
              className="flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold transition-colors duration-150"
              style={{
                background: on ? "var(--pane-chip-faint)" : "transparent",
                color: on ? "var(--pane-chip)" : "var(--pane-muted)",
              }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </nav>

      {section === "pulse" && <PulseSection />}
      {section === "screener" && <MarketScreener />}
      {section === "smart" && <SmartMoney />}
      {section === "maps" && <MapsSection />}
      {section === "calendar" && <CalendarSection />}
    </div>
  );
}
