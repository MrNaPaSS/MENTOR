"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { api, SignalOut } from "@/lib/api";
import { fmtUsd, isLong, modeLabel } from "@/lib/format";

const FILTERS = [
  { key: "all", label: "Все" },
  { key: "active", label: "Активные" },
  { key: "closed", label: "Закрытые" },
] as const;

export default function SignalsFeed() {
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    api.signals().then(setSignals).catch(() => setSignals([])).finally(() => setLoaded(true));
  }, []);

  const visible = useMemo(() => {
    return signals.filter((s) => {
      if (filter !== "all" && s.status !== filter) return false;
      if (q && !s.symbol.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [signals, filter, q]);

  return (
    <div className="space-y-6">
      <h1 className="text-h2 text-white">Лента сигналов</h1>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filter === f.key ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            className="input pl-9"
            placeholder="Поиск по тикеру"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* Список */}
      {!loaded ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card"><div className="skeleton h-16 w-full" /></div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="card text-center text-text-muted">Сигналов не найдено.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((s) => (
            <Link
              key={s.id}
              href={`/app/signals/${s.id}`}
              className="card transition hover:border-accent-cyan/40"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`badge-${isLong(s.direction) ? "success" : "danger"}`}>{s.direction}</span>
                  <span className="text-lg font-bold text-white">{s.symbol}</span>
                  <span className="text-sm text-text-muted">x{s.leverage}</span>
                </div>
                <span className={`badge-${s.status === "active" ? "cyan" : "muted"}`}>
                  {s.status === "active" ? "🟢 Активен" : "⚫ Закрыт"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-text-secondary sm:grid-cols-4">
                <span>Вход {fmtUsd(s.entry_price, 4)}$</span>
                <span>Стоп {fmtUsd(s.stop_loss, 4)}$</span>
                <span>TP1 {fmtUsd(s.tp1, 4)}$</span>
                <span>TP3 {fmtUsd(s.tp3, 4)}$</span>
              </div>
              <div className="mt-2 text-xs text-text-muted">{modeLabel(s.target_audience)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
