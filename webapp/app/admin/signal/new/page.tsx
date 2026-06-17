"use client";

import { useState } from "react";
import { Send, TrendingUp, TrendingDown } from "lucide-react";
import { api, DeliveryPreview } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import { fmtUsd, modeLabel } from "@/lib/format";

function tvImageUrl(url: string): string | null {
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

const AUDIENCE = [
  { key: "all",      label: "Всем" },
  { key: "moderate", label: "Умеренным" },
  { key: "turbo",    label: "Турбо" },
] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-text-secondary">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export default function NewSignal() {
  const token = useMentorToken();

  const [symbol,     setSymbol]     = useState("");
  const [direction,  setDirection]  = useState<"LONG" | "SHORT">("LONG");
  const [leverage,   setLeverage]   = useState("20");
  const [entry,      setEntry]      = useState("");
  const [sl,         setSl]         = useState("");
  const [tp1,        setTp1]        = useState("");
  const [tp2,        setTp2]        = useState("");
  const [tp3,        setTp3]        = useState("");
  const [chartUrl,   setChartUrl]   = useState("");
  const [audience,   setAudience]   = useState<(typeof AUDIENCE)[number]["key"]>("all");

  const [deliveries, setDeliveries] = useState<DeliveryPreview[] | null>(null);
  const [sentSymbol, setSentSymbol] = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);

  const long = direction === "LONG";

  async function send() {
    if (!symbol || !entry || !sl) {
      setError("Заполните пару, вход и стоп.");
      return;
    }
    setLoading(true);
    setError(null);
    setDeliveries(null);
    try {
      const res = await api.createSignalDirect(token, {
        symbol,
        direction,
        leverage: parseInt(leverage) || 20,
        entry_price: parseFloat(entry),
        stop_loss: parseFloat(sl),
        tp1: tp1 ? parseFloat(tp1) : undefined,
        tp2: tp2 ? parseFloat(tp2) : undefined,
        tp3: tp3 ? parseFloat(tp3) : undefined,
        audience,
        chart_url: chartUrl || undefined,
      });
      setDeliveries(res.deliveries);
      setSentSymbol(res.signal.symbol);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-h2 text-white">Новый сигнал</h1>

      <div className="card space-y-5">

        {/* Направление + Пара */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-sm text-text-secondary">Направление</p>
            <div className="flex gap-2">
              <button
                onClick={() => setDirection("LONG")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-bold transition-all ${
                  long
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-white/10 bg-white/[0.02] text-text-muted hover:text-white"
                }`}
              >
                <TrendingUp className="h-4 w-4" /> LONG
              </button>
              <button
                onClick={() => setDirection("SHORT")}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-bold transition-all ${
                  !long
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-white/10 bg-white/[0.02] text-text-muted hover:text-white"
                }`}
              >
                <TrendingDown className="h-4 w-4" /> SHORT
              </button>
            </div>
          </div>

          <Field label="Пара (тикер)">
            <input
              className="input font-mono uppercase"
              placeholder="HYPE, SOL, BTC…"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.replace(/\s/g, "").toUpperCase())}
            />
          </Field>
        </div>

        {/* Плечо */}
        <Field label="Плечо">
          <div className="flex gap-2">
            {["5","10","20","50","100"].map((v) => (
              <button
                key={v}
                onClick={() => setLeverage(v)}
                className={`flex-1 rounded-xl border py-2 text-sm font-bold transition-all ${
                  leverage === v
                    ? "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan"
                    : "border-white/10 bg-white/[0.02] text-text-muted hover:text-white"
                }`}
              >
                ×{v}
              </button>
            ))}
            <input
              className="input w-20 font-mono text-center text-sm"
              placeholder="×?"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </Field>

        {/* Уровни цен */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Вход">
            <input className="input font-mono" placeholder="0.00" value={entry}
              onChange={(e) => setEntry(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Стоп-лосс">
            <input className="input font-mono border-danger/30 focus:border-danger/60" placeholder="0.00" value={sl}
              onChange={(e) => setSl(e.target.value)} inputMode="decimal" />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="TP1">
            <input className="input font-mono border-success/20 focus:border-success/50" placeholder="0.00" value={tp1}
              onChange={(e) => setTp1(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="TP2">
            <input className="input font-mono border-success/20 focus:border-success/50" placeholder="0.00" value={tp2}
              onChange={(e) => setTp2(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="TP3">
            <input className="input font-mono border-accent-cyan/20 focus:border-accent-cyan/50" placeholder="0.00" value={tp3}
              onChange={(e) => setTp3(e.target.value)} inputMode="decimal" />
          </Field>
        </div>

        {/* TradingView чарт */}
        <Field label="График TradingView (необязательно)">
          <input
            className="input font-mono text-sm"
            placeholder="https://www.tradingview.com/x/eQTQ071J/"
            value={chartUrl}
            onChange={(e) => setChartUrl(e.target.value.trim())}
          />
          {chartUrl && tvImageUrl(chartUrl) && (
            <img
              src={tvImageUrl(chartUrl)!}
              alt="chart preview"
              className="mt-2 w-full max-h-48 rounded-xl border border-border object-cover"
            />
          )}
        </Field>

        {/* Аудитория */}
        <div>
          <p className="mb-1.5 text-sm text-text-secondary">Аудитория</p>
          <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
            {AUDIENCE.map((a) => (
              <button key={a.key} onClick={() => setAudience(a.key)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  audience === a.key ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
                }`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn-primary w-full" onClick={send} disabled={loading || !symbol || !entry || !sl}>
          {loading ? "Отправляем…" : <><Send className="h-4 w-4" /> Отправить сигнал</>}
        </button>

        {error && <p className="text-sm text-danger">⚠️ {error}</p>}
      </div>

      {deliveries && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold text-white">
            Расчёт · {sentSymbol} {direction} ×{leverage} ({deliveries.length} студ.)
          </h2>
          {deliveries.length === 0 ? (
            <p className="text-text-muted">Нет учеников в этой аудитории.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-text-muted">
                <tr>
                  <th className="py-2">Ученик</th>
                  <th>Режим</th>
                  <th className="text-right">Баланс</th>
                  <th className="text-right">Маржа</th>
                  <th className="text-right">Риск</th>
                  <th className="text-right">Статус</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="py-2 font-medium text-white">@{d.username || "-"}</td>
                    <td className="text-text-secondary">{modeLabel(d.mode)}</td>
                    <td className="text-right font-mono">{fmtUsd(d.balance)}$</td>
                    <td className="text-right font-mono">{d.margin_usd ? `${fmtUsd(d.margin_usd)}$` : "-"}</td>
                    <td className="text-right font-mono">{d.risk_usd ? `${fmtUsd(d.risk_usd)}$` : "-"}</td>
                    <td className="text-right">
                      <span className={d.status === "skipped" ? "badge-muted" : "badge-success"}>
                        {d.status === "skipped" ? "пропуск" : "ожидает"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-text-muted">Сигнал в очереди. Telegram-рассылку выполняет бот.</p>
        </div>
      )}
    </div>
  );
}
