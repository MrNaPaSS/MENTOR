"use client";

import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  interval?: string;
  height?: number;
  showToolbar?: boolean;
  fullHeight?: boolean;
  chartStyle?: string; // "1"=свечи, "8"=Heikin-Ashi
  studies?: string[];
}

export default function TradingChart({
  symbol,
  interval = "15",
  height = 480,
  showToolbar = true,
  fullHeight = false,
  chartStyle = "8",
  studies = [],
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

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.cssText = fullHeight
      ? "position:absolute; inset:0; width:100%; height:100%;"
      : `width:100%; height:${height}px;`;
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: fullHeight,
      width: "100%",
      height: fullHeight ? "100%" : height,
      symbol: sym,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: chartStyle,
      locale: "ru",
      backgroundColor: "#0b0e11",
      gridColor: "rgba(43,49,57,0.3)",
      allow_symbol_change: true,
      withdateranges: showToolbar,
      hide_side_toolbar: !showToolbar,
      hide_top_toolbar: !showToolbar,
      details: false,
      hotlist: false,
      calendar: false,
      news: [],
      studies,
      show_popup_button: false,
      save_image: false,
      overrides: {
        "paneProperties.background":               "#0b0e11",
        "paneProperties.backgroundType":           "solid",
        "paneProperties.vertGridProperties.color": "rgba(43,49,57,0.3)",
        "paneProperties.horzGridProperties.color": "rgba(43,49,57,0.3)",
        "scalesProperties.backgroundColor":        "#0b0e11",
        "scalesProperties.lineColor":              "rgba(43,49,57,0.6)",
        "scalesProperties.textColor":              "#6b7280",
        "mainSeriesProperties.candleStyle.upColor":         "#0ecb81",
        "mainSeriesProperties.candleStyle.downColor":       "#f6465d",
        "mainSeriesProperties.candleStyle.borderUpColor":   "#0ecb81",
        "mainSeriesProperties.candleStyle.borderDownColor": "#f6465d",
        "mainSeriesProperties.candleStyle.wickUpColor":     "#0ecb81",
        "mainSeriesProperties.candleStyle.wickDownColor":   "#f6465d",
        "mainSeriesProperties.haStyle.upColor":         "#0ecb81",
        "mainSeriesProperties.haStyle.downColor":       "#f6465d",
        "mainSeriesProperties.haStyle.borderUpColor":   "#0ecb81",
        "mainSeriesProperties.haStyle.borderDownColor": "#f6465d",
        "mainSeriesProperties.haStyle.wickUpColor":     "#0ecb81",
        "mainSeriesProperties.haStyle.wickDownColor":   "#f6465d",
      },
    });
    container.appendChild(script);

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [symbol, interval, height, showToolbar, fullHeight, chartStyle, studies]);

  if (fullHeight) {
    return (
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{ width: "100%", height, display: "block", overflow: "hidden", flexShrink: 0 }}
    />
  );
}
