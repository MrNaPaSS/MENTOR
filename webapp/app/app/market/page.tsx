"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Building2, Map, Search, TrendingUp } from "lucide-react";
import { useTerminalTheme } from "@/lib/terminalTheme";

const SmartMoney   = dynamic(() => import("@/app/app/smartmoney/page"), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-border/50 bg-bg-panel p-4">
          <div className="mb-3 h-4 w-40 rounded bg-bg-panel/60" />
          <div className="space-y-2">
            <div className="h-3 rounded bg-bg-panel/60" style={{ width: "80%" }} />
            <div className="h-3 rounded bg-bg-panel/60" style={{ width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  ),
});

// ── Универсальный TradingView виджет ─────────────────────────────────────────

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
  // Виджет рисует чужой скрипт, и тему он берёт один раз - из настроек, с
  // которыми его завели. Раньше там стояло «тёмная» намертво: на белой странице
  // посреди светлых панелей висел чёрный прямоугольник. Тему берём у терминала,
  // как берут её все остальные разделы.
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
      // Фон под цвет карточки, в которой виджет лежит: чужой скрипт своей
      // рамки не рисует, и любое расхождение читается швом.
      backgroundColor: theme === "light" ? "#ffffff" : "#0b0e11",
    });
    el.appendChild(script);

    return () => { if (el) el.innerHTML = ""; };
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

// ── Тепловая карта крипты ─────────────────────────────────────────────────────

function HeatmapSection() {
  return (
    <div className="space-y-4">
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Тепловая карта криптовалют</h3>
            <p className="text-[11px] text-text-muted">Размер - капитализация · Цвет - изменение цены</p>
          </div>
          <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">LIVE</span>
        </div>
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
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-0 overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text-primary">Форекс тепловая карта</h3>
            <p className="text-[11px] text-text-muted">Кросс-курсы валютных пар</p>
          </div>
          <TvWidget
            scriptName="embed-widget-forex-cross-rates.js"
            config={{
              currencies: ["EUR", "USD", "JPY", "GBP", "CHF", "AUD", "CAD", "NZD"],
            }}
            height={400}
          />
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-text-primary">ETF тепловая карта</h3>
            <p className="text-[11px] text-text-muted">Изменение ETF-фондов за день</p>
          </div>
          <TvWidget
            scriptName="embed-widget-etf-heatmap.js"
            config={{
              dataSource: "AllUSEtf",
              blockSize: "aum",
              blockColor: "change",
              hasTopBar: false,
            }}
            height={400}
          />
        </div>
      </div>
    </div>
  );
}

// ── Скринер ───────────────────────────────────────────────────────────────────

function ScreenerSection() {
  return (
    <div className="space-y-4">
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Скринер криптовалют</h3>
            <p className="text-[11px] text-text-muted">Фильтрация и поиск по всем монетам</p>
          </div>
        </div>
        <TvWidget
          scriptName="embed-widget-screener.js"
          config={{
            defaultColumn: "overview",
            defaultScreen: "general",
            market: "crypto",
            showToolbar: true,
          }}
          height={600}
        />
      </div>
    </div>
  );
}

// ── Обзор рынка ───────────────────────────────────────────────────────────────

function OverviewSection() {
  return (
    <div className="space-y-4">
      {/* Экономический календарь - полная ширина */}
      <div className="card p-0 overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-text-primary">Экономический календарь</h3>
          <p className="text-[11px] text-text-muted">Макроэкономические события, влияющие на рынок</p>
        </div>
        <TvWidget
          scriptName="embed-widget-events.js"
          config={{}}
          height={760}
        />
      </div>
    </div>
  );
}

// ── Страница Рынок ────────────────────────────────────────────────────────────

type Section = "smart" | "heatmap" | "screener" | "overview";

const TABS: { key: Section; label: string; icon?: React.ReactNode }[] = [
  { key: "smart",    label: "Smart Money", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "heatmap",  label: "Тепловая карта", icon: <Map className="h-3.5 w-3.5" /> },
  { key: "screener", label: "Скринер",     icon: <Search className="h-3.5 w-3.5" /> },
  { key: "overview", label: "Обзор рынка", icon: <TrendingUp className="h-3.5 w-3.5" /> },
];

export default function MarketPage() {
  const [section, setSection] = useState<Section>("smart");

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div>
        <h1 className="text-2xl font-extrabold text-text-primary">Рынок</h1>
        <p className="text-sm text-text-muted">Smart Money · Тепловая карта · Скринер · Обзор рынка</p>
      </div>

      {/* Вкладки */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-border bg-bg-panel p-1">
        {TABS.map((t) => {
          const active = section === t.key;
          const isGold = t.key === "smart";
          return (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                active
                  ? isGold
                    ? "bg-accent-gold/15 text-accent-gold"
                    : "bg-accent-cyan/15 text-accent-cyan"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Контент */}
      {section === "smart"    && <SmartMoney />}
      {section === "heatmap"  && <HeatmapSection />}
      {section === "screener" && <ScreenerSection />}
      {section === "overview" && <OverviewSection />}

    </div>
  );
}
