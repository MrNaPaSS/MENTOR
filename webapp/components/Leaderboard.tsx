"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { api, LeaderboardRow } from "@/lib/api";
import { fmtUsd, modeLabel } from "@/lib/format";

const MEDALS = ["🥇", "🥈", "🥉"];
const PERIODS = ["Всё время", "Месяц", "Неделя"] as const;

const TOP_BORDER = [
  "border-l-accent-gold shadow-[inset_3px_0_0_0_var(--accent-gold)]",
  "border-l-[#C0C0C0] shadow-[inset_3px_0_0_0_#C0C0C0]",
  "border-l-[#CD7F32] shadow-[inset_3px_0_0_0_#CD7F32]",
];

interface LeaderboardProps {
  limit?: number;
  showHeading?: boolean;
}

export default function Leaderboard({ limit, showHeading = true }: LeaderboardProps) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("Всё время");

  useEffect(() => {
    api
      .leaderboard()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);

  const visible = limit ? rows.slice(0, limit) : rows;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        {showHeading && <h3 className="text-xl font-semibold text-white">Лидерборд</h3>}
        <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-text-muted">
              <th className="px-5 py-3 font-medium">#</th>
              <th className="py-3 font-medium">Трейдер</th>
              <th className="py-3 font-medium">Режим</th>
              <th className="px-5 py-3 text-right font-medium">Баланс</th>
            </tr>
          </thead>
          <tbody>
            {!loaded &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-5 py-3.5"><div className="skeleton h-4 w-4" /></td>
                  <td className="py-3.5"><div className="skeleton h-4 w-28" /></td>
                  <td className="py-3.5"><div className="skeleton h-4 w-20" /></td>
                  <td className="px-5 py-3.5"><div className="skeleton ml-auto h-4 w-16" /></td>
                </tr>
              ))}

            {loaded && visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-text-muted">
                  Пока нет данных лидерборда.
                </td>
              </tr>
            )}

            {visible.map((r) => {
              const top = r.rank <= 3;
              return (
                <tr
                  key={r.rank}
                  className={`border-t border-border/60 border-l-2 transition hover:bg-white/[0.02] ${
                    top ? TOP_BORDER[r.rank - 1] : "border-l-transparent"
                  } ${r.rank % 2 === 0 ? "bg-bg-panel/40" : ""}`}
                >
                  <td className="px-5 py-3.5">
                    <span className="text-lg">{MEDALS[r.rank - 1] || <span className="font-mono text-text-muted">{r.rank}</span>}</span>
                  </td>
                  <td className="py-3.5">
                    <div className="flex items-center gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://i.pravatar.cc/64?u=${r.username || r.rank}`}
                        alt=""
                        className="h-8 w-8 rounded-full ring-1 ring-border"
                        loading="lazy"
                      />
                      <span className="font-medium text-white">@{r.username || "—"}</span>
                    </div>
                  </td>
                  <td className="py-3.5">
                    <span className="text-text-secondary">{modeLabel(r.mode)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono font-semibold text-white tabular">
                    {fmtUsd(r.balance)}$
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-text-muted">
        <Crown className="h-3.5 w-3.5 text-accent-gold" />
        Топ-3 отмечены медалями. Обновляется в реальном времени.
      </div>
    </div>
  );
}
