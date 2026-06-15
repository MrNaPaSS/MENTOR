"use client";

import { useEffect, useRef, useState } from "react";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
  "DOGEUSDT", "AVAXUSDT", "ADAUSDT", "LTCUSDT", "DOTUSDT",
  "MATICUSDT", "LINKUSDT", "UNIUSDT", "ATOMUSDT", "NEARUSDT",
];

interface Ticker {
  symbol: string;
  price: number;
  change: number; // % за 24ч
}

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 100)   return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1)     return price.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

export default function MarketTicker() {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        // Binance public API — без ключей, точные цены в реальном времени
        const symbolsParam = encodeURIComponent(JSON.stringify(SYMBOLS));
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbolsParam}`
        );
        if (!res.ok) return;
        const data: Array<{
          symbol: string;
          lastPrice: string;
          priceChangePercent: string;
        }> = await res.json();

        setTickers(
          data.map((t) => ({
            symbol: t.symbol,
            price: parseFloat(t.lastPrice),
            change: parseFloat(t.priceChangePercent),
          }))
        );
      } catch {
        // При ошибке ничего не показываем — тикер скрыт
      }
    }

    load();
    const id = setInterval(load, 15_000); // обновление каждые 15с
    return () => clearInterval(id);
  }, []);

  if (!tickers.length) return null;

  // Дублируем для бесшовной прокрутки
  const items = [...tickers, ...tickers];

  return (
    <div className="overflow-hidden border-b border-border/50 bg-bg-deep/90 backdrop-blur-sm">
      <div
        ref={trackRef}
        className="flex animate-marquee gap-8 whitespace-nowrap py-2 will-change-transform"
        style={{ width: "max-content" }}
      >
        {items.map((t, i) => {
          const pos = t.change >= 0;
          const sym = t.symbol.replace("USDT", "");
          return (
            <span key={i} className="flex items-center gap-1.5 text-xs">
              {/* Цветная точка = индикатор направления */}
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: pos ? "#00D4A0" : "#FF4757" }}
              />
              <span className="font-semibold text-text-secondary">{sym}</span>
              <span className="font-mono font-medium text-white tabular-nums">
                ${formatPrice(t.price)}
              </span>
              <span
                className="font-mono text-[11px] font-semibold tabular-nums"
                style={{ color: pos ? "#00D4A0" : "#FF4757" }}
              >
                {pos ? "▲" : "▼"} {Math.abs(t.change).toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
