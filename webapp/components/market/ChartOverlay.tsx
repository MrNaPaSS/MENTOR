"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, X } from "lucide-react";
import { isLong } from "@/lib/format";
import TradingChart from "@/components/market/TradingChart";
import OrderBook from "@/components/market/OrderBook";

interface Props {
  symbol: string;
  direction?: string;
  onClose: () => void;
}

/** Полноэкранный график (Heikin-Ashi) + стакан, появляется анимацией переворота. */
export default function ChartOverlay({ symbol, direction, onClose }: Props) {
  const [show, setShow] = useState(false);
  const [bookRows, setBookRows] = useState(16);
  const bookRef = useRef<HTMLDivElement>(null);
  const long = direction ? isLong(direction) : null;
  const DirectionIcon = long ? TrendingUp : TrendingDown;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShow(true));
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && handleClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Подбираем число строк стакана так, чтобы он заполнял высоту графика
  useEffect(() => {
    const el = bookRef.current;
    if (!el) return;
    const update = () => {
      const r = Math.max(8, Math.floor((el.clientHeight - 150) / (2 * 20)));
      setBookRows(r);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function handleClose() {
    setShow(false);
    setTimeout(onClose, 480); // дождаться обратной анимации переворота
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
      {/* Затемнение */}
      <div
        onClick={handleClose}
        className={`absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity duration-500 ${show ? "opacity-100" : "opacity-0"}`}
      />

      {/* Панель — переворачивается при появлении */}
      <div style={{ perspective: "2200px" }} className="relative z-10 h-[78vh] max-h-[760px] w-full max-w-[1400px]">
        <div
          className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0b0e11] shadow-[0_24px_80px_rgba(0,0,0,0.7)] transition-all duration-500 ease-[cubic-bezier(.22,.68,.16,1)]"
          style={{
            transformOrigin: "center",
            transform: show ? "rotateY(0deg)" : "rotateY(80deg)",
            opacity: show ? 1 : 0,
          }}
        >
          {/* Шапка */}
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-base font-extrabold text-white sm:text-lg">{symbol}</span>
              {long !== null && (
                <span
                  className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    long ? "border-success/25 bg-success/[0.1] text-success" : "border-danger/25 bg-danger/[0.1] text-danger"
                  }`}
                >
                  <DirectionIcon className="h-3 w-3" strokeWidth={2.5} />
                  {direction}
                </span>
              )}
              <span className="rounded-md border border-accent-cyan/25 bg-accent-cyan/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-cyan">
                Heikin-Ashi
              </span>
            </div>
            <button
              onClick={handleClose}
              title="Закрыть (Esc)"
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white/70 ring-1 ring-inset ring-white/[0.08] transition hover:bg-white/[0.08] hover:text-white"
            >
              Закрыть
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* График + стакан */}
          <div className="grid min-h-0 flex-1 grid-rows-[1fr_40vh] lg:grid-cols-[1fr_340px] lg:grid-rows-1">
            <div className="relative min-h-0">
              <TradingChart symbol={symbol} interval="15" chartStyle="8" showToolbar fullHeight />
            </div>
            <div ref={bookRef} className="min-h-0 overflow-hidden border-t border-white/[0.07] lg:border-l lg:border-t-0">
              <OrderBook symbol={symbol} rows={bookRows} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
