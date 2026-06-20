"use client";

import { useEffect, useMemo, useState } from "react";
import { api, SignalOut } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import SignalCard from "@/components/signals/SignalCard";
import { Search, Wallet, Radio } from "lucide-react";

type StatusKey = "all" | "active" | "closed";

interface SegOption<T extends string> {
  key: T;
  label: string;
  dot?: string;
}

const STATUS_OPTIONS: SegOption<StatusKey>[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "Активные", dot: "bg-success shadow-[0_0_6px] shadow-success/60" },
  { key: "closed", label: "Закрытые", dot: "bg-text-muted" },
];

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${
              active
                ? "bg-white/[0.07] text-white ring-1 ring-inset ring-white/[0.08]"
                : "text-text-muted hover:text-white/80"
            }`}
          >
            {o.dot && <span className={`h-1.5 w-1.5 rounded-full ${o.dot}`} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Лента сигналов с расчётом позиции под депозит пользователя.
 * Баланс подтягивается из профиля автоматически, пользователь может изменить его вручную.
 */
export default function SignalsFeed() {
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<StatusKey>("all");
  const [q, setQ] = useState("");
  const [balance, setBalance] = useState(1000);

  useEffect(() => {
    api.signals().then(setSignals).catch(() => setSignals([])).finally(() => setLoaded(true));
    const token = getAccessToken();
    if (token)
      api.profile(token)
        .then((p) => {
          if (p.balance_usdt) setBalance(Math.round(parseFloat(p.balance_usdt)));
        })
        .catch(() => {});
  }, []);

  const visible = useMemo(
    () =>
      signals.filter((s) => {
        if (filter !== "all" && s.status !== filter) return false;
        if (q && !s.symbol.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [signals, filter, q]
  );

  const activeCount = useMemo(() => signals.filter((s) => s.status === "active").length, [signals]);

  return (
    <div className="space-y-5">
      {/* ── Панель управления ───────────────────────────────────── */}
      <div className="rounded-2xl border border-white/[0.06] bg-bg-panel/40 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Фильтры */}
          <div className="flex flex-wrap items-center gap-2">
            <Segmented options={STATUS_OPTIONS} value={filter} onChange={setFilter} />
          </div>

          {/* Депозит для расчёта */}
          <div className="flex items-center gap-2.5 rounded-xl border border-accent-cyan/20 bg-accent-cyan/[0.05] px-3.5 py-2">
            <Wallet className="h-4 w-4 shrink-0 text-accent-cyan/70" />
            <div className="flex flex-col leading-tight">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                Депозит для расчёта
              </span>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-sm text-accent-cyan/60">$</span>
                <input
                  inputMode="numeric"
                  value={balance.toLocaleString("en-US")}
                  onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                    setBalance(Number.isNaN(n) ? 0 : n);
                  }}
                  className="w-24 bg-transparent font-mono text-sm font-bold text-white outline-none tabular"
                />
                <span className="text-[10px] font-medium text-text-muted">USDT</span>
              </div>
            </div>
          </div>
        </div>

        {/* Поиск */}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-text-muted outline-none transition focus:border-accent-cyan/40 focus:bg-white/[0.03]"
            placeholder="Поиск по паре — BTC, ETH, SOL…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* ── Список ──────────────────────────────────────────────── */}
      {!loaded ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-white/[0.06] bg-bg-panel">
              <div className="skeleton h-64 w-full" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-white/[0.06] bg-bg-panel py-20 text-center text-text-muted">
          <Radio className="mb-3 h-10 w-10 opacity-20" />
          <p className="font-medium">Сигналов не найдено</p>
          <p className="mt-1 text-sm opacity-60">
            {signals.length === 0 ? "Ментор ещё не опубликовал сигналы" : "Попробуйте изменить фильтры"}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-muted">
              Показано <span className="font-semibold text-white">{visible.length}</span>
              {activeCount > 0 && (
                <>
                  {" · "}
                  <span className="text-success">{activeCount} активных</span>
                </>
              )}
            </span>
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {visible.map((s) => (
              <SignalCard key={s.id} signal={s} balance={balance} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
