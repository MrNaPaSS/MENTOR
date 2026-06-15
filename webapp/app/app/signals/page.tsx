"use client";

import { useEffect, useMemo, useState } from "react";
import { api, SignalOut } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { fmtUsd } from "@/lib/format";
import SignalCard from "@/components/signals/SignalCard";
import { Search, SlidersHorizontal } from "lucide-react";

const FILTERS = [
  { key: "all", label: "Все" },
  { key: "active", label: "🟢 Активные" },
  { key: "closed", label: "⚫ Закрытые" },
] as const;

const MODES = [
  { key: "all", label: "Все режимы" },
  { key: "moderate", label: "📊 Умеренный" },
  { key: "turbo", label: "⚡ Турбо" },
] as const;

export default function SignalsFeed() {
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "closed">("all");
  const [mode, setMode] = useState<"all" | "moderate" | "turbo">("all");
  const [q, setQ] = useState("");
  const [balance, setBalance] = useState(1000);

  useEffect(() => {
    api.signals().then(setSignals).catch(() => setSignals([])).finally(() => setLoaded(true));
    const token = getAccessToken();
    if (token) api.profile(token).then(p => { if (p.balance_usdt) setBalance(parseFloat(p.balance_usdt)); }).catch(() => {});
  }, []);

  const visible = useMemo(() => signals.filter((s) => {
    if (filter !== "all" && s.status !== filter) return false;
    if (mode !== "all" && s.target_audience !== mode) return false;
    if (q && !s.symbol.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [signals, filter, mode, q]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-white">Лента сигналов</h1>
        <span className="badge-muted">{visible.length} сигналов</span>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Статус */}
        <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filter === f.key ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
              }`}>{f.label}</button>
          ))}
        </div>

        {/* Режим */}
        <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => setMode(m.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === m.key ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
              }`}>{m.label}</button>
          ))}
        </div>

        {/* Поиск */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input className="input pl-9" placeholder="Поиск по паре (BTC, ETH...)"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {/* Баланс для расчёта */}
        <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-panel px-3 py-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-[10px] text-text-muted">Депозит</span>
          <input
            type="number"
            value={balance}
            onChange={(e) => setBalance(parseFloat(e.target.value) || 1000)}
            className="w-20 bg-transparent font-mono text-xs text-white outline-none tabular"
          />
          <span className="text-[10px] text-text-muted">USDT</span>
        </div>
      </div>

      {/* Список */}
      {!loaded ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card">
              <div className="skeleton h-48 w-full" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="card grid place-items-center py-16 text-center text-text-muted">
          <Search className="mb-3 h-10 w-10 opacity-30" />
          <p>Сигналов не найдено</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((s) => (
            <SignalCard key={s.id} signal={s} balance={balance} />
          ))}
        </div>
      )}
    </div>
  );
}
