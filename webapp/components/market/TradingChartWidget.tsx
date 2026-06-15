"use client";

import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  interval?: string;
  height?: number;
  compact?: boolean; // для встраивания в карточку сигнала
}

export default function TradingChartWidget({
  symbol,
  interval = "15",
  height = 280,
  compact = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: symbol.includes(":") ? symbol : symbol === "BTC.D" ? "CRYPTOCAP:BTC.D" : `WEEX:${symbol}`,
      width: "100%",
      height: height,
      locale: "ru",
      dateRange: "1D",
      colorTheme: "dark",
      isTransparent: true,
      autosize: false,
      largeChartUrl: "",
      chartOnly: compact,
    });

    container.appendChild(script);
    return () => { if (container) container.innerHTML = ""; };
  }, [symbol, interval, height]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container overflow-hidden rounded-xl"
      style={{ height }}
    />
  );
}
