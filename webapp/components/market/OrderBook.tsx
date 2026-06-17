"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

interface Level {
  price: number;
  size: number;
}

interface LevelWithCum extends Level {
  cum: number;
}

interface Trade {
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuy: boolean;
}

type BookMode = "both" | "asks" | "bids";
type Tab = "book" | "trades";

function parseLevel(l: unknown): Level {
  if (Array.isArray(l)) return { price: parseFloat(l[0]), size: parseFloat(l[1]) };
  const o = l as Record<string, unknown>;
  return {
    price: parseFloat(String(o.price ?? o.p ?? 0)),
    size: parseFloat(String(o.size ?? o.s ?? o.qty ?? 0)),
  };
}

function fmtPrice(n: number): string {
  if (n >= 10_000) return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (n >= 100) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function fmtSize(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n < 1 ? n.toFixed(4) : n.toFixed(3);
}

function fmtUsdt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

const ROW_H = 20;
const TRADE_ROW_H = 19;

interface Props {
  symbol: string;
  rows?: number;
  compact?: boolean;
}

export default function OrderBook({ symbol, rows = 14, compact = false }: Props) {
  const [tab, setTab] = useState<Tab>("book");
  const [data, setData] = useState<{ bids: unknown[]; asks: unknown[] } | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [spread, setSpread] = useState<string | null>(null);
  const [priceDir, setPriceDir] = useState<"up" | "down" | null>(null);
  const [mode, setMode] = useState<BookMode>("both");
  const prevMidRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayRows = compact ? Math.min(rows, 8) : rows;
  const ticker = symbol.replace("USDT", "");

  async function loadBook() {
    try {
      const res = await fetch(`${API_URL}/api/market/orderbook/${symbol}?limit=${displayRows}`);
      if (!res.ok) return;
      const json = (await res.json()) as { bids: unknown[]; asks: unknown[] };

      if (json.bids?.length && json.asks?.length) {
        const topBid = parseLevel(json.bids[0]).price;
        const topAsk = parseLevel(json.asks[0]).price;
        const sp = ((topAsk - topBid) / topBid) * 100;
        setSpread(sp.toFixed(sp < 0.01 ? 4 : 3) + "%");

        if (prevMidRef.current !== null) {
          setPriceDir(topBid > prevMidRef.current ? "up" : topBid < prevMidRef.current ? "down" : null);
        }
        prevMidRef.current = topBid;
      }
      setData(json);
    } catch { /* silent */ }
  }

  async function loadTrades() {
    try {
      const res = await fetch(`${API_URL}/api/market/trades/${symbol}?limit=30`);
      if (!res.ok) return;
      const json = (await res.json()) as { trades: Trade[] };
      setTrades(json.trades || []);
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (tab === "book") {
      loadBook();
      timerRef.current = setInterval(loadBook, 1000);
    } else {
      loadTrades();
      timerRef.current = setInterval(loadTrades, 1500);
    }

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, displayRows, tab]);

  /* ── Header (shared) ── */
  const Header = () => (
    <div className="flex items-center justify-between border-b border-border/50 px-3" style={{ height: 36 }}>
      <div className="flex items-center gap-3">
        <span
          onClick={() => setTab("book")}
          className={`cursor-pointer text-[11px] font-semibold transition ${
            tab === "book" ? "text-white" : "text-text-muted hover:text-white"
          }`}
        >
          Книга ордеров
        </span>
        <span
          onClick={() => setTab("trades")}
          className={`cursor-pointer text-[11px] font-semibold transition ${
            tab === "trades" ? "text-white" : "text-text-muted hover:text-white"
          }`}
        >
          Сделки
        </span>
      </div>

      {tab === "book" && (
        <div className="flex items-center gap-1">
          {(["both", "asks", "bids"] as BookMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex h-5 w-6 items-center justify-center rounded-sm transition ${
                mode === m ? "bg-white/10" : "hover:bg-white/5"
              }`}
              title={m}
            >
              {m === "both" && (
                <span className="flex flex-col gap-[1px]">
                  <span className="block h-[3px] w-4 rounded-[1px] bg-success/80" />
                  <span className="block h-[3px] w-4 rounded-[1px] bg-danger/80" />
                </span>
              )}
              {m === "asks" && <span className="block h-[6px] w-4 rounded-[1px] bg-danger/80" />}
              {m === "bids" && <span className="block h-[6px] w-4 rounded-[1px] bg-success/80" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /* ── Trades tab ── */
  if (tab === "trades") {
    return (
      <div className="flex select-none flex-col bg-bg-deep" style={{ height: "100%" }}>
        <Header />

        {/* Column labels */}
        <div className="flex items-center border-b border-border/30 font-mono" style={{ height: 24 }}>
          <span className="w-[28%] pl-3 text-[9px] uppercase tracking-wider text-text-muted">Время</span>
          <span className="w-[28%] text-right text-[9px] uppercase tracking-wider text-text-muted">Цена</span>
          <span className="w-[22%] text-right text-[9px] uppercase tracking-wider text-text-muted">{ticker}</span>
          <span className="w-[22%] pr-3 text-right text-[9px] uppercase tracking-wider text-text-muted">USDT</span>
        </div>

        {/* Trade rows */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {trades.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-[11px] text-text-muted">
              Загрузка…
            </div>
          ) : (
            trades.map((t, i) => (
              <div
                key={i}
                className="relative flex items-center font-mono"
                style={{ height: TRADE_ROW_H }}
              >
                <div
                  className="pointer-events-none absolute inset-y-0 left-0"
                  style={{
                    width: "3px",
                    background: t.isBuy ? "rgba(14,203,129,0.6)" : "rgba(246,70,93,0.6)",
                  }}
                />
                <span className="w-[28%] pl-4 text-[10px] text-text-muted tabular">
                  {fmtTime(t.time)}
                </span>
                <span
                  className={`w-[28%] text-right text-[11px] font-medium tabular ${
                    t.isBuy ? "text-success" : "text-danger"
                  }`}
                >
                  {fmtPrice(parseFloat(t.price))}
                </span>
                <span className="w-[22%] text-right text-[10px] text-text-secondary tabular">
                  {fmtSize(parseFloat(t.qty))}
                </span>
                <span className="w-[22%] pr-3 text-right text-[10px] text-text-muted tabular">
                  {fmtUsdt(parseFloat(t.quoteQty))}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  /* ── Order book tab ── */
  if (!data) {
    const skelH = 36 + displayRows * ROW_H + 36 + displayRows * ROW_H + 28;
    return <div className="skeleton w-full rounded-none opacity-40" style={{ height: skelH }} />;
  }

  const bids: LevelWithCum[] = [];
  let bidCum = 0;
  (data.bids || []).slice(0, displayRows).forEach(l => {
    const { price, size } = parseLevel(l);
    bidCum += size;
    bids.push({ price, size, cum: bidCum });
  });

  const asks: LevelWithCum[] = [];
  let askCum = 0;
  (data.asks || []).slice(0, displayRows).forEach(l => {
    const { price, size } = parseLevel(l);
    askCum += size;
    asks.push({ price, size, cum: askCum });
  });

  const maxCum = Math.max(askCum, bidCum, 1);
  const midPrice = bids[0]?.price ?? 0;
  const bidTotal = bidCum;
  const askTotal = askCum;
  const grandTotal = bidTotal + askTotal || 1;
  const bidPct = Math.round((bidTotal / grandTotal) * 100);
  const askPct = 100 - bidPct;

  const AskRow = ({ level }: { level: LevelWithCum }) => {
    const depthPct = (level.cum / maxCum) * 100;
    return (
      <div className="relative flex items-center font-mono" style={{ height: ROW_H }}>
        <div
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{ width: `${depthPct}%`, background: "rgba(246,70,93,0.12)" }}
        />
        <span className="relative z-10 w-[42%] pl-3 text-[11px] font-medium text-danger tabular">
          {fmtPrice(level.price)}
        </span>
        <span className="relative z-10 w-[30%] text-right text-[11px] text-text-secondary tabular">
          {fmtSize(level.size)}
        </span>
        <span className="relative z-10 w-[28%] pr-3 text-right text-[11px] text-text-muted tabular">
          {fmtSize(level.cum)}
        </span>
      </div>
    );
  };

  const BidRow = ({ level }: { level: LevelWithCum }) => {
    const depthPct = (level.cum / maxCum) * 100;
    return (
      <div className="relative flex items-center font-mono" style={{ height: ROW_H }}>
        <div
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{ width: `${depthPct}%`, background: "rgba(14,203,129,0.10)" }}
        />
        <span className="relative z-10 w-[42%] pl-3 text-[11px] font-medium text-success tabular">
          {fmtPrice(level.price)}
        </span>
        <span className="relative z-10 w-[30%] text-right text-[11px] text-text-secondary tabular">
          {fmtSize(level.size)}
        </span>
        <span className="relative z-10 w-[28%] pr-3 text-right text-[11px] text-text-muted tabular">
          {fmtSize(level.cum)}
        </span>
      </div>
    );
  };

  return (
    <div className="flex select-none flex-col bg-bg-deep" style={{ height: "100%" }}>
      <Header />

      {/* Колонки */}
      <div className="flex items-center border-b border-border/30 font-mono" style={{ height: 24 }}>
        <span className="w-[42%] pl-3 text-[9px] uppercase tracking-wider text-text-muted">
          Цена (USDT)
        </span>
        <span className="w-[30%] text-right text-[9px] uppercase tracking-wider text-text-muted">
          Сумма ({ticker})
        </span>
        <span className="w-[28%] pr-3 text-right text-[9px] uppercase tracking-wider text-text-muted">
          Всего ({ticker})
        </span>
      </div>

      {/* Аски - снизу вверх */}
      {mode !== "bids" && (
        <div className="flex flex-col-reverse" style={{ height: displayRows * ROW_H }}>
          {asks.map((a, i) => <AskRow key={i} level={a} />)}
        </div>
      )}

      {/* Текущая цена */}
      <div
        className="flex items-center justify-between border-y border-border/60 bg-bg-panel px-3"
        style={{ height: 36 }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`font-mono text-[15px] font-bold tabular transition-colors ${
              priceDir === "up" ? "text-success" : priceDir === "down" ? "text-danger" : "text-white"
            }`}
          >
            {fmtPrice(midPrice)}
          </span>
          {priceDir === "up" && <span className="text-[10px] text-success">▲</span>}
          {priceDir === "down" && <span className="text-[10px] text-danger">▼</span>}
        </div>
        <span className="text-[9px] text-text-muted">Спред {spread}</span>
      </div>

      {/* Биды */}
      {mode !== "asks" && (
        <div className="flex flex-col" style={{ height: displayRows * ROW_H }}>
          {bids.map((b, i) => <BidRow key={i} level={b} />)}
        </div>
      )}

      {/* B / S бар */}
      <div className="mt-auto border-t border-border/50 px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[10px] font-semibold text-success">B {bidPct}%</span>
          <span className="font-mono text-[10px] font-semibold text-danger">{askPct}% S</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-success transition-all duration-500"
            style={{ width: `${bidPct}%` }}
          />
          <div
            className="bg-danger transition-all duration-500"
            style={{ width: `${askPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
