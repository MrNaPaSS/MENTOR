"use client";

import { useEffect, useState } from "react";
import { api, LeaderboardRow } from "@/lib/api";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.leaderboard().then(setRows).catch((e) => setError(e.message));
  }, []);

  if (error) return null;

  return (
    <div className="card overflow-x-auto">
      <h3 className="mb-4 text-xl font-semibold">Лидерборд</h3>
      {rows.length === 0 ? (
        <p className="text-text-muted">Пока нет данных.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-text-muted">
            <tr>
              <th className="py-2">#</th>
              <th>Ник</th>
              <th>Режим</th>
              <th className="text-right">Баланс</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rank} className="border-t border-border">
                <td className="py-2">{MEDALS[r.rank - 1] || r.rank}</td>
                <td>@{r.username || "—"}</td>
                <td>
                  <span className="text-text-secondary">{r.mode}</span>
                </td>
                <td className="text-right font-mono">
                  {r.balance ? Number(r.balance).toLocaleString("en-US") : "—"}$
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
