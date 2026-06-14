"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, RefreshCw, AlertTriangle } from "lucide-react";
import { api, CalcResponse } from "@/lib/api";
import { fmtUsd, fmtPct } from "@/lib/format";

const MAX_LEV = { moderate: 25, turbo: 400 } as const;

export default function Calculator() {
  const [mode, setMode] = useState<"moderate" | "turbo">("moderate");
  const [balance, setBalance] = useState("1000");
  const [entry, setEntry] = useState("100");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [leverage, setLeverage] = useState(10);
  const [pair, setPair] = useState("BTCUSDT");
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);

  const maxLev = MAX_LEV[mode];

  function changeMode(m: "moderate" | "turbo") {
    setMode(m);
    setLeverage((lev) => Math.min(lev, MAX_LEV[m]));
  }

  async function fetchPrice() {
    setPriceLoading(true);
    try {
      const res = await api.price(pair.trim().toUpperCase());
      setEntry(res.price);
    } catch {
      /* без цены — оставляем введённое */
    } finally {
      setPriceLoading(false);
    }
  }

  async function compute() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.calculate({
        mode,
        balance,
        entry_price: entry,
        direction,
        leverage,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка расчёта");
    } finally {
      setLoading(false);
    }
  }

  const riskPct = result ? Number(result.risk_percent_of_balance) : 0;
  const riskHigh = riskPct > 5;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-xl font-semibold text-white">Калькулятор позиции</h3>
        <p className="mt-0.5 text-sm text-text-muted">
          Рассчитай маржу, риск и профит под свой депозит — бесплатно.
        </p>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-2">
        {/* ── Ввод ── */}
        <div className="space-y-5 bg-bg-card p-6">
          {/* Режим */}
          <div>
            <label className="mb-2 block text-sm text-text-secondary">Режим</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg-panel p-1">
              <button
                onClick={() => changeMode("moderate")}
                className={`rounded-lg py-2 text-sm font-semibold transition ${
                  mode === "moderate" ? "bg-accent-cyan text-bg-deep" : "text-text-secondary hover:text-white"
                }`}
              >
                📊 Умеренный
              </button>
              <button
                onClick={() => changeMode("turbo")}
                className={`rounded-lg py-2 text-sm font-semibold transition ${
                  mode === "turbo" ? "bg-danger text-white" : "text-text-secondary hover:text-white"
                }`}
              >
                ⚡ Турбо
              </button>
            </div>
          </div>

          {/* Направление */}
          <div>
            <label className="mb-2 block text-sm text-text-secondary">Направление</label>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg-panel p-1">
              <button
                onClick={() => setDirection("LONG")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                  direction === "LONG" ? "bg-success/20 text-success ring-1 ring-success/40" : "text-text-secondary hover:text-white"
                }`}
              >
                <TrendingUp className="h-4 w-4" /> LONG
              </button>
              <button
                onClick={() => setDirection("SHORT")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${
                  direction === "SHORT" ? "bg-danger/20 text-danger ring-1 ring-danger/40" : "text-text-secondary hover:text-white"
                }`}
              >
                <TrendingDown className="h-4 w-4" /> SHORT
              </button>
            </div>
          </div>

          {/* Депозит / Пара */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-text-secondary">
              Депозит ($)
              <input
                className="input mt-1.5 font-mono"
                inputMode="decimal"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
              />
            </label>
            <label className="block text-sm text-text-secondary">
              Пара
              <input
                className="input mt-1.5 font-mono uppercase"
                value={pair}
                onChange={(e) => setPair(e.target.value)}
              />
            </label>
          </div>

          {/* Цена входа */}
          <label className="block text-sm text-text-secondary">
            Цена входа ($)
            <div className="mt-1.5 flex gap-2">
              <input
                className="input font-mono"
                inputMode="decimal"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
              />
              <button
                onClick={fetchPrice}
                className="btn-outline shrink-0 px-3"
                aria-label="Обновить цену"
                disabled={priceLoading}
              >
                <RefreshCw className={`h-4 w-4 ${priceLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </label>

          {/* Плечо (слайдер) */}
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-text-secondary">Плечо</span>
              <span className="font-mono font-semibold text-accent-cyan">x{leverage}</span>
            </div>
            <input
              type="range"
              min={1}
              max={maxLev}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-[#0AFFE0]"
            />
            <div className="mt-1 flex justify-between text-[11px] text-text-muted">
              <span>1x</span>
              <span>до {maxLev}x ({mode === "turbo" ? "турбо" : "умеренный"})</span>
            </div>
          </div>

          <button className="btn-primary w-full" onClick={compute} disabled={loading}>
            {loading ? "Считаем…" : "Рассчитать"}
          </button>
        </div>

        {/* ── Вывод (чек) ── */}
        <div className="bg-bg-panel p-6">
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}

          {!result ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-text-muted">
              <p>Заполни параметры и нажми «Рассчитать»</p>
              <p className="mt-1 text-xs">Маржа · объём · риск · профиты появятся здесь</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Маржа" value={`${fmtUsd(result.margin_usd)}$`} />
                <Metric label="Объём позиции" value={`${fmtUsd(result.position_size)}$`} />
                <Metric
                  label={`Риск (стоп ${fmtPct(result.sl_percent, 2)}%)`}
                  value={`${fmtUsd(result.risk_usd)}$`}
                  tone={riskHigh ? "danger" : undefined}
                />
                <Metric label="Стоп" value={`${result.sl_price}$`} />
              </div>

              <div className="space-y-2">
                {result.take_profits.map((tp) => (
                  <div
                    key={tp.index}
                    className="flex items-center justify-between rounded-xl border border-border bg-bg-card px-3.5 py-2.5"
                  >
                    <span className="text-sm text-text-secondary">
                      {`TP${tp.index} (RR 1:${Number(tp.rr).toFixed(1)})`}
                    </span>
                    <span className="font-mono font-semibold text-success">
                      +{fmtUsd(tp.profit_usd)}$
                    </span>
                  </div>
                ))}
              </div>

              {result.take_profits[0] && (
                <div className="flex items-center justify-between rounded-xl border border-accent-gold/30 bg-accent-gold/[0.06] px-3.5 py-2.5">
                  <span className="text-sm text-text-secondary">Риск / Прибыль (TP1)</span>
                  <span className="badge-gold font-mono">
                    1:{Number(result.take_profits[0].rr).toFixed(1)}
                  </span>
                </div>
              )}

              {result.warnings.length > 0 && (
                <ul className="space-y-1 pt-1 text-sm text-accent-gold">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2">
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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  const color =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-white";
  return (
    <div className="rounded-xl border border-border bg-bg-card p-3">
      <div className={`font-mono text-lg font-semibold ${color}`}>{value}</div>
      <div className="mt-0.5 text-xs text-text-muted">{label}</div>
    </div>
  );
}
