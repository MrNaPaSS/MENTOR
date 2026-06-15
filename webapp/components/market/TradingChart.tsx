"use client";

import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  interval?: string;
  height?: number;
  showToolbar?: boolean;
}

export default function TradingChart({
  symbol,
  interval = "15",
  height = 480,
  showToolbar = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const sym =
      symbol === "BTC.D"
        ? "CRYPTOCAP:BTC.D"
        : symbol.includes(":")
        ? symbol
        : `WEEX:${symbol}`;

    // Widget-div ПЕРЕД скриптом — TradingView ищет его именно так
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.cssText = `width:100%; height:${height}px;`;
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      // autosize:false + явная высота = единственный надёжный способ
      autosize: false,
      width: "100%",
      height: height,
      symbol: sym,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "8",           // Heikin Ashi по умолчанию
      locale: "ru",
      backgroundColor: "#0A0A1A",
      gridColor: "rgba(42,42,62,0.5)",
      allow_symbol_change: true,
      withdateranges: showToolbar,
      hide_side_toolbar: !showToolbar,
      hide_top_toolbar: false,
      details: false,
      hotlist: false,
      calendar: false,
      news: [],
      studies: [],
      show_popup_button: false,
      save_image: false,
    });
    container.appendChild(script);

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [symbol, interval, height, showToolbar]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{
        width: "100%",
        height,
        display: "block",
        overflow: "hidden",
        flexShrink: 0,
      }}
    />
  );
}
