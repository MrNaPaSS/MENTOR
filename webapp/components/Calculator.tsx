"use client";

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, RefreshCw, AlertTriangle, ChevronRight } from "lucide-react";
import { api, CalcResponse } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { fmtUsd } from "@/lib/format";

const MAX_LEV = 400;

export default function Calculator() {
  const [balance, setBalance] = useState("1000");
  const [balanceFromProfile, setBalanceFromProfile] = useState(false);
  const [entry, setEntry] = useState("100");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [leverage, setLeverage] = useState(10);
  const [pair, setPair] = useState("BTCUSDT");
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);

  const leveragePct = (leverage / MAX_LEV) * 100;

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.profile(token).then(p => {
      if (p.balance_usdt && parseFloat(p.balance_usdt) > 0) {
        setBalance(parseFloat(p.balance_usdt).toFixed(2));
        setBalanceFromProfile(true);
      }
    }).catch(() => {});
  }, []);

  async function fetchPrice() {
    setPriceLoading(true);
    try {
      const res = await api.price(pair.trim().toUpperCase());
      setEntry(res.price);
    } catch { /* keep typed value */ }
    finally { setPriceLoading(false); }
  }

  async function compute() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.calculate({ mode: "turbo", balance, entry_price: entry, direction, leverage });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка расчёта");
    } finally {
      setLoading(false);
    }
  }

  const riskPct = result ? Number(result.risk_percent_of_balance) : 0;

  return (
    <div
      className="overflow-hidden rounded-3xl"
      style={{
        background: "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}
    >
      <div className="grid md:grid-cols-2">

        {/* ─── LEFT: INPUT PANEL ─── */}
        <div className="space-y-6 p-7">

          {/* Direction */}
          <div className="grid grid-cols-2 gap-3">
            {(["LONG", "SHORT"] as const).map((d) => {
              const active = direction === d;
              const isLong = d === "LONG";
              const color = isLong ? "#00D4A0" : "#FF4757";
              return (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className="flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all duration-200"
                  style={{
                    background: active ? `${color}18` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${active ? color + "50" : "rgba(255,255,255,0.07)"}`,
                    color: active ? color : "rgba(255,255,255,0.4)",
                    boxShadow: active ? `0 0 20px ${color}15` : "none",
                  }}
                >
                  {isLong
                    ? <TrendingUp className="h-4 w-4" />
                    : <TrendingDown className="h-4 w-4" />
                  }
                  {d}
                </button>
              );
            })}
          </div>

          {/* Balance + Pair */}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={balanceFromProfile ? "Депозит (WEEX)" : "Депозит ($)"}
              accent={balanceFromProfile}
            >
              <input
                className="input font-mono"
                inputMode="decimal"
                value={balance}
                onChange={(e) => { setBalance(e.target.value); setBalanceFromProfile(false); }}
              />
            </Field>
            <Field label="Торговая пара">
              <input
                className="input font-mono uppercase"
                value={pair}
                onChange={(e) => setPair(e.target.value)}
              />
            </Field>
          </div>

          {/* Entry price */}
          <Field label="Цена входа ($)">
            <div className="flex gap-2">
              <input
                className="input font-mono"
                inputMode="decimal"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
              />
              <button
                onClick={fetchPrice}
                disabled={priceLoading}
                className="flex h-[42px] w-11 shrink-0 items-center justify-center rounded-lg transition-all"
                style={{ background: "rgba(10,255,224,0.08)", border: "1px solid rgba(10,255,224,0.2)", color: "#0AFFE0" }}
                aria-label="Получить текущую цену"
              >
                <RefreshCw className={`h-4 w-4 ${priceLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </Field>

          {/* Leverage slider */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-text-secondary">Плечо</span>
              <span
                className="rounded-lg px-2.5 py-1 font-mono text-sm font-bold"
                style={{ background: "rgba(10,255,224,0.1)", color: "#0AFFE0", border: "1px solid rgba(10,255,224,0.2)" }}
              >
                ×{leverage}
              </span>
            </div>

            <div className="relative h-1.5 w-full rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-all"
                style={{ width: `${leveragePct}%`, background: "linear-gradient(90deg, #0AFFE0, #06B6D4)" }}
              />
              <input
                type="range"
                min={1}
                max={MAX_LEV}
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </div>

            <div className="mt-2 flex justify-between text-[11px] text-text-muted">
              <span>×1</span>
              <span>×400</span>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={compute}
            disabled={loading}
            className="group relative w-full overflow-hidden rounded-2xl py-3.5 text-[15px] font-bold text-bg-deep transition-all duration-200 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #0AFFE0 0%, #06B6D4 100%)" }}
          >
            <span className="flex items-center justify-center gap-2">
              {loading ? "Считаем…" : <>Рассчитать <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </span>
          </button>
        </div>

        {/* ─── RIGHT: RESULT PANEL ─── */}
        <div
          className="p-7"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}
        >
          {error && (
            <div className="mb-5 flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)", color: "#FF4757" }}>
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {!result ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
              <div
                className="mb-4 grid h-16 w-16 place-items-center rounded-2xl"
                style={{ background: "rgba(10,255,224,0.06)", border: "1px solid rgba(10,255,224,0.12)" }}
              >
                <TrendingUp className="h-7 w-7" style={{ color: "#0AFFE0", opacity: 0.5 }} />
              </div>
              <p className="font-semibold text-white opacity-40">Заполни параметры</p>
              <p className="mt-1 text-xs text-text-muted opacity-60">Маржа · объём · риск · тейки появятся здесь</p>
            </div>
          ) : (
            <div className="space-y-4">

              {/* Top metrics */}
              <div className="grid grid-cols-2 gap-3">
                <ResultCard label="Маржа" value={`$${fmtUsd(result.margin_usd)}`} accent="cyan" />
                <ResultCard label="Объём позиции" value={`$${fmtUsd(result.position_size)}`} accent="cyan" />
              </div>

              {/* Risk + SL row */}
              <div className="grid grid-cols-2 gap-3">
                <ResultCard
                  label={`Риск (стоп ${Number(result.sl_percent).toFixed(1)}%)`}
                  value={`$${fmtUsd(result.risk_usd)}`}
                  accent={riskPct > 5 ? "danger" : "neutral"}
                />
                <ResultCard label="Цена стопа" value={`$${result.sl_price}`} accent="neutral" />
              </div>

              {/* TP rows */}
              <div
                className="rounded-2xl p-1"
                style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                {result.take_profits.map((tp, i) => (
                  <div
                    key={tp.index}
                    className="flex items-center justify-between rounded-xl px-4 py-3"
                    style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}
                  >
                    <div>
                      <span className="text-xs font-semibold text-text-muted">
                        TP{tp.index} · RR 1:{Number(tp.rr).toFixed(1)}
                      </span>
                    </div>
                    <span className="font-mono font-bold" style={{ color: "#00D4A0" }}>
                      +${fmtUsd(tp.profit_usd)}
                    </span>
                  </div>
                ))}
              </div>

              {/* RR summary */}
              {result.take_profits[0] && (
                <div
                  className="flex items-center justify-between rounded-2xl px-4 py-3"
                  style={{ background: "rgba(255,196,0,0.06)", border: "1px solid rgba(255,196,0,0.2)" }}
                >
                  <span className="text-sm text-text-secondary">Risk / Reward (TP1)</span>
                  <span className="font-mono font-bold" style={{ color: "#FFC400" }}>
                    1 : {Number(result.take_profits[0].rr).toFixed(1)}
                  </span>
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <ul className="space-y-1.5">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "#F59E0B" }}>
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-text-secondary">
        {label}
        {accent && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#0AFFE0" }} />}
      </div>
      {children}
    </div>
  );
}

function ResultCard({ label, value, accent }: { label: string; value: string; accent: "cyan" | "danger" | "neutral" }) {
  const color = accent === "cyan" ? "#0AFFE0" : accent === "danger" ? "#FF4757" : "white";
  const bg = accent === "cyan" ? "rgba(10,255,224,0.05)" : accent === "danger" ? "rgba(255,71,87,0.08)" : "rgba(255,255,255,0.03)";
  const border = accent === "cyan" ? "rgba(10,255,224,0.12)" : accent === "danger" ? "rgba(255,71,87,0.2)" : "rgba(255,255,255,0.06)";
  return (
    <div className="rounded-2xl p-4" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="font-mono text-xl font-black tabular-nums" style={{ color }}>{value}</div>
      <div className="mt-1 text-xs text-text-muted">{label}</div>
    </div>
  );
}
