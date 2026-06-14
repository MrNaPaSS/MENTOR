"use client";

import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { api, StudentOut } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import { fmtUsd, maskUid } from "@/lib/format";

export default function AdminStudents() {
  const token = useMentorToken();
  const [students, setStudents] = useState<StudentOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  function load() {
    api.students(token).then(setStudents).catch(() => setStudents([])).finally(() => setLoaded(true));
  }
  useEffect(load, [token]);

  function replace(s: StudentOut) {
    setStudents((prev) => prev.map((x) => (x.id === s.id ? s : x)));
  }

  async function approve(id: number) {
    setBusy(id);
    try {
      replace(await api.studentApprove(token, id));
    } finally {
      setBusy(null);
    }
  }
  async function toggleActive(s: StudentOut) {
    setBusy(s.id);
    try {
      replace(await api.studentPatch(token, s.id, { is_active: !s.is_active }));
    } finally {
      setBusy(null);
    }
  }
  async function setMode(s: StudentOut, mode: string) {
    setBusy(s.id);
    try {
      replace(await api.studentPatch(token, s.id, { mode }));
    } finally {
      setBusy(null);
    }
  }
  async function remove(id: number) {
    if (!confirm("Удалить ученика?")) return;
    setBusy(id);
    try {
      await api.studentDelete(token, id);
      setStudents((prev) => prev.filter((x) => x.id !== id));
    } finally {
      setBusy(null);
    }
  }

  const pending = students.filter((s) => !s.is_approved);

  return (
    <div className="space-y-6">
      <h1 className="text-h2 text-white">Ученики ({students.length})</h1>

      {/* Заявки */}
      {pending.length > 0 && (
        <div className="card border-accent-gold/30">
          <h2 className="mb-3 text-lg font-semibold text-accent-gold">Ожидают подтверждения ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-bg-panel px-4 py-2.5">
                <span className="font-medium text-white">@{s.username || s.id}</span>
                <div className="flex gap-2">
                  <button onClick={() => approve(s.id)} disabled={busy === s.id} className="btn-primary px-3 py-1.5 text-xs">
                    <Check className="h-3.5 w-3.5" /> Принять
                  </button>
                  <button onClick={() => remove(s.id)} disabled={busy === s.id} className="btn-outline px-3 py-1.5 text-xs">
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {!loaded ? (
          <div className="skeleton h-40 w-full" />
        ) : students.length === 0 ? (
          <p className="text-center text-text-muted">Учеников пока нет.</p>
        ) : (
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-text-muted">
              <tr>
                <th className="py-2">Ник</th>
                <th>UID</th>
                <th>Режим</th>
                <th className="text-right">Баланс</th>
                <th className="text-center">Активен</th>
                <th className="text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="py-2.5 font-medium text-white">@{s.username || s.id}</td>
                  <td className="font-mono text-text-muted">{maskUid(s.weex_uid)}</td>
                  <td>
                    <div className="flex gap-1 rounded-lg border border-border bg-bg-panel p-0.5">
                      {(["moderate", "turbo"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setMode(s, m)}
                          disabled={busy === s.id}
                          className={`rounded px-2 py-1 text-[11px] font-semibold ${
                            s.mode === m ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted"
                          }`}
                        >
                          {m === "turbo" ? "⚡" : "📊"}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="text-right font-mono">{fmtUsd(s.balance_usdt)}$</td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleActive(s)}
                      disabled={busy === s.id}
                      className={`badge-${s.is_active ? "success" : "muted"}`}
                    >
                      {s.is_active ? "вкл" : "выкл"}
                    </button>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => remove(s.id)}
                      disabled={busy === s.id}
                      className="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:text-danger"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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
