"use client";

import { useEffect, useState } from "react";
import { Crown, TrendingUp, Medal } from "lucide-react";
import { api, LeaderboardRow } from "@/lib/api";
import { fmtUsd, modeLabel } from "@/lib/format";

// ─── Mock-данные лидерборда ──────────────────────────────────────────────────
const MOCK_ROWS: LeaderboardRow[] = [
  { rank: 1, username: "crypto_wolf",   mode: "turbo",    balance: "58420.00" },
  { rank: 2, username: "solana_king",   mode: "turbo",    balance: "41890.00" },
  { rank: 3, username: "btc_hunter",    mode: "moderate", balance: "34200.00" },
  { rank: 4, username: "eth_master",    mode: "moderate", balance: "28750.00" },
  { rank: 5, username: "xrp_pro",       mode: "turbo",    balance: "22100.00" },
  { rank: 6, username: "defi_trader",   mode: "moderate", balance: "18600.00" },
  { rank: 7, username: "moon_signal",   mode: "moderate", balance: "15340.00" },
  { rank: 8, username: "altcoin_ace",   mode: "turbo",    balance: "12800.00" },
  { rank: 9, username: "bnb_baron",     mode: "moderate", balance: "10250.00" },
  { rank: 10, username: "hodl_legend",  mode: "moderate", balance: "8900.00" },
];

const MEDALS_DATA = [
  { emoji: "🥇", label: "1st", color: "#FFD700", shadow: "0 0 20px rgba(255,215,0,0.4)" },
  { emoji: "🥈", label: "2nd", color: "#C0C0C0", shadow: "0 0 20px rgba(192,192,192,0.3)" },
  { emoji: "🥉", label: "3rd", color: "#CD7F32", shadow: "0 0 20px rgba(205,127,50,0.3)" },
];

const PERIODS = ["Всё время", "Месяц", "Неделя"] as const;

interface LeaderboardProps {
  limit?: number;
  showHeading?: boolean;
}

export default function Leaderboard({ limit, showHeading = true }: LeaderboardProps) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("Всё время");

  useEffect(() => {
    api.leaderboard()
      .then((r) => setRows(r.length ? r : MOCK_ROWS))
      .catch(() => setRows(MOCK_ROWS))
      .finally(() => setLoaded(true));
  }, []);

  const visible = (limit ? rows.slice(0, limit) : rows);
  const top3 = visible.slice(0, 3);
  const rest = visible.slice(3);
  const maxBalance = parseFloat(visible[0]?.balance || "1");

  return (
    <div className="overflow-hidden rounded-2xl border border-white/8"
      style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)" }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
        {showHeading && (
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-accent-gold" />
            <h3 className="text-xl font-bold text-white">Лидерборд</h3>
          </div>
        )}
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                period === p ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Топ-3 карточки */}
      {loaded && top3.length > 0 && (
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {[top3[1], top3[0], top3[2]].filter(Boolean).map((r) => {
            if (!r) return null;
            const m = MEDALS_DATA[r.rank - 1];
            const pct = Math.round((parseFloat(r.balance ?? "0") / maxBalance) * 100);
            const isFirst = r.rank === 1;
            return (
              <div
                key={r.rank}
                className={`relative overflow-hidden rounded-2xl border p-4 text-center transition-all duration-300 hover:-translate-y-1 ${isFirst ? "order-first sm:order-none" : ""}`}
                style={{
                  borderColor: m.color + "40",
                  background: `radial-gradient(ellipse at top, ${m.color}10 0%, transparent 70%)`,
                  boxShadow: isFirst ? m.shadow : "none",
                }}
              >
                {isFirst && (
                  <div className="absolute inset-x-0 top-0 h-0.5"
                    style={{ background: `linear-gradient(90deg, transparent, ${m.color}, transparent)` }}
                  />
                )}

                <div className="text-3xl">{m.emoji}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://i.pravatar.cc/80?u=${r.username ?? r.rank}`}
                  alt={r.username ?? ""}
                  className={`mx-auto mt-2 rounded-2xl object-cover ring-2 ring-white/20 ${isFirst ? "h-16 w-16" : "h-12 w-12"}`}
                  loading="lazy"
                />
                <div className="mt-2 font-bold text-white">@{r.username ?? "—"}</div>
                <div className="text-[10px] text-text-muted">{modeLabel(r.mode)}</div>
                <div
                  className="mt-3 font-mono text-lg font-extrabold"
                  style={{ color: m.color }}
                >
                  ${fmtUsd(r.balance)}
                </div>

                {/* Прогресс-бар */}
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${pct}%`, background: m.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Места 4–10 */}
      {loaded && rest.length > 0 && (
        <div className="divide-y divide-white/5 px-4 pb-4">
          {rest.map((r) => {
            const pct = Math.round((parseFloat(r.balance ?? "0") / maxBalance) * 100);
            return (
              <div
                key={r.rank}
                className="flex items-center gap-4 py-3 transition hover:bg-white/[0.02] rounded-xl px-2"
              >
                <span className="w-7 text-center font-mono text-sm font-bold text-text-muted">
                  {r.rank}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://i.pravatar.cc/64?u=${r.username}`}
                  alt=""
                  className="h-8 w-8 rounded-xl ring-1 ring-white/10"
                  loading="lazy"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm">@{r.username}</div>
                  <div className="text-[11px] text-text-muted">{modeLabel(r.mode)}</div>
                </div>
                <div className="w-24 shrink-0">
                  <div className="text-right font-mono text-sm font-bold text-white">${fmtUsd(r.balance)}</div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-accent-cyan/60"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Скелетон */}
      {!loaded && (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton h-4 w-6 rounded" />
              <div className="skeleton h-8 w-8 rounded-xl" />
              <div className="skeleton h-4 flex-1 rounded" />
              <div className="skeleton h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-white/5 px-5 py-3 text-xs text-text-muted">
        <Medal className="h-3.5 w-3.5 text-accent-gold" />
        Топ-3 отмечены медалями · Баланс USDT · Обновляется каждые 24ч
      </div>
    </div>
  );
}
