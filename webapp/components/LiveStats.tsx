"use client";

import { useEffect, useState } from "react";
import { api, PublicStats } from "@/lib/api";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <div className="font-mono text-3xl font-bold text-accent-cyan">{value}</div>
      <div className="mt-1 text-sm text-text-secondary">{label}</div>
    </div>
  );
}

export default function LiveStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.publicStats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <p className="text-center text-text-muted">
        API недоступен ({error}). Запусти бэкенд: <code>uvicorn backend.main:app</code>
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      <Stat label="Сигналов отправлено" value={stats ? String(stats.total_signals) : "—"} />
      <Stat label="Активных сигналов" value={stats ? String(stats.active_signals) : "—"} />
      <Stat label="Активных учеников" value={stats ? String(stats.active_students) : "—"} />
    </div>
  );
}
