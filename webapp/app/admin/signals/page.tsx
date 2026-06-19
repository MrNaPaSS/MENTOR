"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, SignalOut } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import { fmtUsd, isLong, modeLabel } from "@/lib/format";

export default function AdminSignals() {
  const token = useMentorToken();
  const [signals, setSignals] = useState<SignalOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  function load() {
    api.signals().then(setSignals).catch(() => setSignals([])).finally(() => setLoaded(true));
  }
  useEffect(load, []);

  async function close(id: number) {
    setBusy(id);
    try {
      await api.closeSignal(token, id);
      setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, status: "closed" } : s)));
    } finally {
      setBusy(null);
    }
  }

  async function del(id: number) {
    setBusy(id);
    setConfirmDelete(null);
    try {
      await api.deleteSignal(token, id);
      setSignals((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-h2 text-white">Сигналы</h1>

      <div className="card overflow-x-auto">
        {!loaded ? (
          <div className="skeleton h-40 w-full" />
        ) : signals.length === 0 ? (
          <p className="text-center text-text-muted">Сигналов пока нет.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-text-muted">
              <tr>
                <th className="py-2">#</th>
                <th>Тикер</th>
                <th>Напр.</th>
                <th>Плечо</th>
                <th>Аудитория</th>
                <th className="text-right">Вход</th>
                <th className="text-center">Статус</th>
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="py-2.5 font-mono text-text-muted">{s.id}</td>
                  <td className="font-semibold text-white">{s.symbol}</td>
                  <td>
                    <span className={`badge-${isLong(s.direction) ? "success" : "danger"}`}>{s.direction}</span>
                  </td>
                  <td className="font-mono">x{s.leverage}</td>
                  <td className="text-text-secondary">{modeLabel(s.target_audience)}</td>
                  <td className="text-right font-mono">{fmtUsd(s.entry_price, 4)}$</td>
                  <td className="text-center">
                    <span className={`badge-${s.status === "active" ? "cyan" : "muted"}`}>
                      {s.status === "active" ? "активен" : "закрыт"}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.status === "active" && (
                        <button
                          onClick={() => close(s.id)}
                          disabled={busy === s.id}
                          className="btn-outline px-3 py-1.5 text-xs"
                        >
                          {busy === s.id ? "…" : "Закрыть"}
                        </button>
                      )}
                      {confirmDelete === s.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => del(s.id)}
                            disabled={busy === s.id}
                            className="rounded-lg border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-xs font-bold text-danger hover:bg-danger/20 transition"
                          >
                            {busy === s.id ? "…" : "Да, удалить"}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="rounded-lg border border-border px-2 py-1.5 text-xs text-text-muted hover:text-white transition"
                          >
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(s.id)}
                          disabled={busy === s.id}
                          title="Удалить сигнал"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted hover:border-danger/50 hover:text-danger transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
