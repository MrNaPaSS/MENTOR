"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Globe, Building2 } from "lucide-react";
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

type Section = "single" | "multi" | "smart";

export default function MarketPage() {
  const [sym, setSym]       = useState("BTCUSDT");
  const [tf, setTf]         = useState("15");
  const [section, setSection] = useState<Section>("smart");

  return (
    <div className="space-y-5">
      {/* Заголовок + главные вкладки */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Рынок</h1>
          <p className="text-sm text-text-muted">Графики · Стакан · F&G · Smart Money</p>
        </div>

        <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
          <button
            onClick={() => setSection("single")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${section === "single" ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"}`}
          >
            <Globe className="h-3.5 w-3.5" /> Одиночный
          </button>
          <button
            onClick={() => setSection("multi")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${section === "multi" ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"}`}
          >
            2×2
          </button>
          <button
            onClick={() => setSection("smart")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${section === "smart" ? "bg-accent-gold/15 text-accent-gold" : "text-text-muted hover:text-white"}`}
          >
            <Building2 className="h-3.5 w-3.5" /> Smart Money
          </button>
        </div>
      </div>

      {/* Smart Money */}
      {section === "smart" && <SmartMoney />}

      {section !== "smart" && section === "single" ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
          {/* Главный блок */}
          <div className="space-y-3">
            {/* Панель управления */}
            <div className="card flex flex-wrap items-center gap-3 p-3">
              {/* Пара */}
              <div className="flex flex-wrap gap-1">
                {PAIRS.map((p) => (
                  <button key={p} onClick={() => setSym(p)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      sym === p ? "bg-accent-cyan text-bg-deep" : "bg-bg-panel text-text-secondary hover:text-white"
                    }`}>{p.replace("USDT", "")}</button>
                ))}
              </div>
              <div className="mx-1 h-5 w-px bg-border" />
              {/* TF */}
              <div className="flex gap-1">
                {TF.map((t) => (
                  <button key={t.key} onClick={() => setTf(t.key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      tf === t.key ? "bg-white/10 text-white" : "text-text-muted hover:text-white"
                    }`}>{t.label}</button>
                ))}
              </div>
            </div>

            {/* График */}
            <div className="card overflow-hidden p-0">
              <TradingChart symbol={sym} interval={tf} height={678} showToolbar />
            </div>
          </div>

          {/* Боковая панель */}
          <div className="space-y-4">
            {/* Стакан */}
            <div className="card overflow-hidden p-0">
              <div className="border-b border-border p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Стакан цен</h3>
                  <span className="text-[10px] text-text-muted">{sym}</span>
                </div>
              </div>
              <OrderBook symbol={sym} rows={14} />
            </div>

            {/* F&G */}
            <FearGreed />
          </div>
        </div>
      ) : section === "multi" ? (
        /* 2×2 Мультичарт */
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
      ) : null}
    </div>
  );
}
