"use client";

import { useState } from "react";
import { api, CalcResponse } from "@/lib/api";

export default function Calculator() {
  const [mode, setMode] = useState("moderate");
  const [balance, setBalance] = useState("1000");
  const [entry, setEntry] = useState("100");
  const [direction, setDirection] = useState("LONG");
  const [leverage, setLeverage] = useState("10");
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function compute() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.calculate({
        mode,
        balance,
        entry_price: entry,
        direction,
        leverage: Number(leverage),
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const num = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });

  return (
    <div className="card">
      <h3 className="mb-4 text-xl font-semibold">Калькулятор позиции</h3>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Режим
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="moderate">Умеренный</option>
            <option value="turbo">Турбо</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Направление
          <select className="input" value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Плечо
          <input className="input" value={leverage} onChange={(e) => setLeverage(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Депозит ($)
          <input className="input" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-secondary">
          Цена входа ($)
          <input className="input" value={entry} onChange={(e) => setEntry(e.target.value)} />
        </label>
        <div className="flex items-end">
          <button className="btn-primary w-full" onClick={compute} disabled={loading}>
            {loading ? "Считаем…" : "Рассчитать"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-danger">⚠️ {error}</p>}

      {result && (
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Маржа" value={`${num(result.margin_usd)}$`} />
          <Metric label="Объём позиции" value={`${num(result.position_size)}$`} />
          <Metric
            label={`Риск (стоп ${Number(result.sl_percent).toFixed(2)}%)`}
            value={`${num(result.risk_usd)}$`}
            danger
          />
          <Metric label="Стоп" value={`${result.sl_price}$`} />
          {result.take_profits.map((tp) => (
            <Metric
              key={tp.index}
              label={`TP${tp.index} (RR 1:${Number(tp.rr).toFixed(1)})`}
              value={`+${num(tp.profit_usd)}$`}
              success
            />
          ))}
        </div>
      )}

      {result && result.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-accent-gold">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  success,
  danger,
}: {
  label: string;
  value: string;
  success?: boolean;
  danger?: boolean;
}) {
  const color = success ? "text-success" : danger ? "text-danger" : "text-text-primary";
  return (
    <div className="rounded-lg border border-border bg-bg-panel p-3">
      <div className={`font-mono text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}
