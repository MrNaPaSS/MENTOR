"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Globe, Building2, Map, Search, TrendingUp } from "lucide-react";
import FearGreed from "@/components/market/FearGreed";

const TradingChart = dynamic(() => import("@/components/market/TradingChart"), { ssr: false });
const OrderBook    = dynamic(() => import("@/components/market/OrderBook"), { ssr: false });
const SmartMoney   = dynamic(() => import("@/app/app/smartmoney/page"), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-border/50 bg-bg-panel p-4">
          <div className="mb-3 h-4 w-40 rounded bg-white/[0.06]" />
          <div className="space-y-2">
            <div className="h-3 rounded bg-white/[0.04]" style={{ width: "80%" }} />
            <div className="h-3 rounded bg-white/[0.04]" style={{ width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  ),
});

const PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT"];
const TF = [
  { key: "1",   label: "1м"  },
  { key: "5",   label: "5м"  },
  { key: "15",  label: "15м" },
  { key: "60",  label: "1ч"  },
  { key: "240", label: "4ч"  },
  { key: "D",   label: "1Д"  },
];

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
      colorTheme: "dark",
      locale: "ru",
      isTransparent: true,
    });
    el.appendChild(script);

    return () => { if (el) el.innerHTML = ""; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptName, configKey, height]);

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
            <h3 className="text-sm font-semibold text-white">Тепловая карта криптовалют</h3>
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
            <h3 className="text-sm font-semibold text-white">Форекс тепловая карта</h3>
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
            <h3 className="text-sm font-semibold text-white">ETF тепловая карта</h3>
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
            <h3 className="text-sm font-semibold text-white">Скринер криптовалют</h3>
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
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-0 overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Обзор крипторынка</h3>
            <p className="text-[11px] text-text-muted">Топ монеты · Изменения · Объёмы</p>
          </div>
          <TvWidget
            scriptName="embed-widget-market-overview.js"
            config={{
              showFloatingTooltip: true,
              tabs: [
                {
                  title: "Крипто",
                  symbols: [
                    { s: "BINANCE:BTCUSDT", d: "Bitcoin" },
                    { s: "BINANCE:ETHUSDT", d: "Ethereum" },
                    { s: "BINANCE:SOLUSDT", d: "Solana" },
                    { s: "BINANCE:BNBUSDT", d: "BNB" },
                    { s: "BINANCE:XRPUSDT", d: "XRP" },
                    { s: "BINANCE:DOGEUSDT", d: "Dogecoin" },
                    { s: "BINANCE:ADAUSDT", d: "Cardano" },
                    { s: "BINANCE:AVAXUSDT", d: "Avalanche" },
                  ],
                  originalTitle: "Crypto",
                },
                {
                  title: "Индексы",
                  symbols: [
                    { s: "FOREXCOM:SPXUSD", d: "S&P 500" },
                    { s: "FOREXCOM:NSXUSD", d: "Nasdaq 100" },
                    { s: "FOREXCOM:DJI", d: "Dow Jones" },
                    { s: "INDEX:NKY", d: "Nikkei 225" },
                    { s: "INDEX:DEU40", d: "DAX" },
                    { s: "CRYPTOCAP:TOTAL", d: "Крипто капитал" },
                    { s: "CRYPTOCAP:BTC.D", d: "BTC доминация" },
                  ],
                  originalTitle: "Indices",
                },
              ],
            }}
            height={520}
          />
        </div>

        <div className="space-y-4">
          <div className="card p-0 overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Топ новости рынка</h3>
              <p className="text-[11px] text-text-muted">Актуальные события</p>
            </div>
            <TvWidget
              scriptName="embed-widget-timeline.js"
              config={{
                feedMode: "market",
                market: "crypto",
                displayMode: "regular",
              }}
              height={250}
            />
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Экономический календарь</h3>
              <p className="text-[11px] text-text-muted">События, влияющие на рынок</p>
            </div>
            <TvWidget
              scriptName="embed-widget-events.js"
              config={{
                height: 250,
              }}
              height={250}
            />
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Тикер - топ активы</h3>
          <p className="text-[11px] text-text-muted">Бегущая строка с ценами в реальном времени</p>
        </div>
        <TvWidget
          scriptName="embed-widget-ticker-tape.js"
          config={{
            symbols: [
              { proName: "BINANCE:BTCUSDT", title: "Bitcoin" },
              { proName: "BINANCE:ETHUSDT", title: "Ethereum" },
              { proName: "BINANCE:SOLUSDT", title: "Solana" },
              { proName: "BINANCE:BNBUSDT", title: "BNB" },
              { proName: "BINANCE:XRPUSDT", title: "XRP" },
              { proName: "BINANCE:DOGEUSDT", title: "Doge" },
              { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
              { proName: "FOREXCOM:NSXUSD", title: "Nasdaq" },
              { proName: "CRYPTOCAP:BTC.D", title: "BTC.D" },
              { proName: "CRYPTOCAP:TOTAL", title: "Общая кап" },
            ],
            showSymbolLogo: true,
            displayMode: "adaptive",
          }}
          height={60}
        />
      </div>
    </div>
  );
}

// ── Страница Рынок ────────────────────────────────────────────────────────────

type Section = "single" | "multi" | "smart" | "heatmap" | "screener" | "overview";

const TABS: { key: Section; label: string; icon?: React.ReactNode }[] = [
  { key: "smart",    label: "Smart Money", icon: <Building2 className="h-3.5 w-3.5" /> },
  { key: "single",   label: "График",      icon: <Globe className="h-3.5 w-3.5" /> },
  { key: "multi",    label: "2×2",         icon: null },
  { key: "heatmap",  label: "Тепловая карта", icon: <Map className="h-3.5 w-3.5" /> },
  { key: "screener", label: "Скринер",     icon: <Search className="h-3.5 w-3.5" /> },
  { key: "overview", label: "Обзор рынка", icon: <TrendingUp className="h-3.5 w-3.5" /> },
];

export default function MarketPage() {
  const [sym, setSym]         = useState("BTCUSDT");
  const [tf, setTf]           = useState("15");
  const [section, setSection] = useState<Section>("smart");

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div>
        <h1 className="text-2xl font-extrabold text-white">Рынок</h1>
        <p className="text-sm text-text-muted">Графики · Тепловые карты · Скринер · Индексы · Smart Money</p>
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
                  : "text-text-muted hover:text-white"
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

      {section === "single" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
          <div className="space-y-3">
            <div className="card flex flex-wrap items-center gap-3 p-3">
              <div className="flex flex-wrap gap-1">
                {PAIRS.map((p) => (
                  <button key={p} onClick={() => setSym(p)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      sym === p ? "bg-accent-cyan text-bg-deep" : "bg-bg-panel text-text-secondary hover:text-white"
                    }`}>{p.replace("USDT", "")}</button>
                ))}
              </div>
              <div className="mx-1 h-5 w-px bg-border" />
              <div className="flex gap-1">
                {TF.map((t) => (
                  <button key={t.key} onClick={() => setTf(t.key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      tf === t.key ? "bg-white/10 text-white" : "text-text-muted hover:text-white"
                    }`}>{t.label}</button>
                ))}
              </div>
            </div>
            <div className="card overflow-hidden p-0">
              <TradingChart symbol={sym} interval={tf} height={678} showToolbar />
            </div>
          </div>
          <div className="space-y-4">
            <div className="card overflow-hidden p-0">
              <div className="border-b border-border p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Стакан цен</h3>
                  <span className="text-[10px] text-text-muted">{sym}</span>
                </div>
              </div>
              <OrderBook symbol={sym} rows={14} />
            </div>
            <FearGreed />
          </div>
        </div>
      )}

      {section === "multi" && (
        <div className="grid gap-3 md:grid-cols-2">
          {PAIRS.slice(0, 4).map((p) => (
            <div key={p} className="card overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-semibold text-white">{p}</span>
                <span className="text-[10px] text-text-muted">15м</span>
              </div>
              <TradingChart symbol={p} interval="15" height={260} showToolbar={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
