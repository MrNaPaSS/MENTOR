"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

function parseLevel(l: any): { price: number; size: number } {
  if (Array.isArray(l)) return { price: parseFloat(l[0]), size: parseFloat(l[1]) };
  return { price: parseFloat(l.price ?? l.p ?? 0), size: parseFloat(l.size ?? l.s ?? l.qty ?? 0) };
}

function fmtSize(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return n < 1 ? n.toFixed(4) : n.toFixed(2);
}

function fmtPrice(n: number) {
  if (n >= 10_000) return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (n >= 100) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

// Высота одной строки и компонентов (px)
const ROW_H = 22;
const HEADER_H = 32;
const SPREAD_H = 30;

interface Props {
  symbol: string;
  rows?: number;       // число уровней с каждой стороны
  compact?: boolean;   // компактный для карточки сигнала
}

export default function OrderBook({ symbol, rows = 12, compact = false }: Props) {
  const [data, setData] = useState<{ bids: any[]; asks: any[] } | null>(null);
  const [spread, setSpread] = useState<string | null>(null);
  const [prevAsks, setPrevAsks] = useState<Record<string, number>>({});
  const [prevBids, setPrevBids] = useState<Record<string, number>>({});
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const displayRows = compact ? Math.min(rows, 8) : rows;

  async function load() {
    try {
      const res = await fetch(`${API_URL}/api/market/orderbook/${symbol}?limit=${displayRows}`);
      if (!res.ok) return;
      const json = await res.json();

      // Трекаем изменения размера для анимации флэша
      const newAsks: Record<string, number> = {};
      const newBids: Record<string, number> = {};
      (json.asks || []).slice(0, displayRows).forEach((l: any) => {
        const { price, size } = parseLevel(l);
        newAsks[String(price)] = size;
      });
      (json.bids || []).slice(0, displayRows).forEach((l: any) => {
        const { price, size } = parseLevel(l);
        newBids[String(price)] = size;
      });

      setPrevAsks(newAsks);
      setPrevBids(newBids);
      setData(json);

      if (json.bids?.length && json.asks?.length) {
        const topBid = parseLevel(json.bids[0]).price;
        const topAsk = parseLevel(json.asks[0]).price;
        const sp = ((topAsk - topBid) / topBid * 100);
        setSpread(sp.toFixed(sp < 0.01 ? 4 : 3) + "%");
      }
    } catch { /* silent */ }
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [symbol, displayRows]);

  // Скелетон фиксированной высоты чтобы layout не прыгал
  const totalH = HEADER_H + displayRows * ROW_H + SPREAD_H + displayRows * ROW_H;

  if (!data) {
    return (
      <div className="w-full" style={{ height: totalH }}>
        <div className="skeleton h-full w-full rounded-none opacity-50" />
      </div>
    );
  }

  const bids = (data.bids || []).slice(0, displayRows).map(parseLevel);
  const asks = (data.asks || []).slice(0, displayRows).map(parseLevel);

  const allSizes = [...bids.map(b => b.size), ...asks.map(a => a.size)];
  const maxSize = Math.max(...allSizes, 1);

  // Накопленные объёмы для глубины
  let askCum = 0;
  const asksWithCum = asks.map(a => { askCum += a.size; return { ...a, cum: askCum }; });
  let bidCum = 0;
  const bidsWithCum = bids.map(b => { bidCum += b.size; return { ...b, cum: bidCum }; });
  const maxCum = Math.max(askCum, bidCum, 1);

  const midPrice = bids[0]?.price || 0;

  const Row = ({
    level,
    side,
    cum,
  }: {
    level: { price: number; size: number };
    side: "bid" | "ask";
    cum: number;
  }) => {
    const isAsk = side === "ask";
    const depthPct = (cum / maxCum) * 100;
    const singlePct = (level.size / maxSize) * 100;

    return (
      <div
        className="relative flex h-[22px] items-center justify-between px-3 font-mono text-xs"
        style={{ lineHeight: "22px" }}
      >
        {/* Полоса глубины (накопленный объём) */}
        <div
          className={`absolute inset-y-0 ${isAsk ? "right-0" : "left-0"} transition-[width]`}
          style={{
            width: `${depthPct}%`,
            backgroundColor: isAsk ? "rgba(255,71,87,0.06)" : "rgba(0,212,160,0.06)",
          }}
        />
        {/* Полоса одиночного ордера */}
        <div
          className={`absolute inset-y-0 ${isAsk ? "right-0" : "left-0"}`}
          style={{
            width: `${singlePct * 0.4}%`,
            backgroundColor: isAsk ? "rgba(255,71,87,0.18)" : "rgba(0,212,160,0.18)",
          }}
        />
        {/* Цена */}
        <span
          className={`relative z-10 tabular font-semibold ${isAsk ? "text-danger" : "text-success"}`}
          style={{ fontSize: compact ? 11 : 12 }}
        >
          {fmtPrice(level.price)}
        </span>
        {/* Объём */}
        <span
          className="relative z-10 text-text-secondary tabular"
          style={{ fontSize: compact ? 10 : 11 }}
        >
          {fmtSize(level.size)}
        </span>
      </div>
    );
  };

  return (
    <div className="flex select-none flex-col" style={{ height: totalH }}>
      {/* Шапка */}
      <div
        className="flex items-center justify-between border-b border-border/40 px-3 text-[10px] font-semibold uppercase tracking-widest text-text-muted"
        style={{ height: HEADER_H }}
      >
        <span>Цена (USDT)</span>
        <span>{symbol.replace("USDT", "")} Объём</span>
      </div>

      {/* Аски (продажи) — снизу вверх, ближайшая цена у спреда */}
      <div className="flex flex-col-reverse" style={{ height: displayRows * ROW_H }}>
        {asksWithCum.map((a, i) => (
          <Row key={i} level={a} side="ask" cum={a.cum} />
        ))}
      </div>

      {/* Спред + средняя цена */}
      <div
        className="flex items-center justify-between border-y border-border/60 bg-bg-panel/80 px-3"
        style={{ height: SPREAD_H }}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-white tabular">
            {fmtPrice(midPrice)}
          </span>
          <span className={`text-[10px] font-semibold ${
            (asks[0]?.price ?? 0) > midPrice ? "text-success" : "text-danger"
          }`}>
            ≈ ${fmtPrice(midPrice)}
          </span>
        </div>
        <span className="text-[10px] text-text-muted">Спред {spread}</span>
      </div>

      {/* Биды (покупки) */}
      <div className="flex flex-col" style={{ height: displayRows * ROW_H }}>
        {bidsWithCum.map((b, i) => (
          <Row key={i} level={b} side="bid" cum={b.cum} />
        ))}
      </div>
    </div>
  );
}
