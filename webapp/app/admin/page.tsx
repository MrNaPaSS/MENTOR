"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, StudentOut, DeliveryPreview } from "@/lib/api";
import { getMentorToken, setMentorToken, logoutMentor } from "@/lib/auth";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(getMentorToken());
  }, []);

  if (!token) return <MentorLogin onLogin={setToken} />;
  return <MentorPanel token={token} onLogout={() => setToken(null)} />;
}

function MentorLogin({ onLogin }: { onLogin: (t: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    try {
      const res = await api.mentorLogin(password);
      setMentorToken(res.access_token);
      onLogin(res.access_token);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="card glow-cyan">
        <h1 className="text-2xl font-bold">
          NMNH <span className="text-accent-gold">ADMIN</span>
        </h1>
        <input
          type="password"
          className="input mt-4 w-full"
          placeholder="Пароль ментора"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn-primary mt-3 w-full" onClick={login} disabled={!password}>
          Войти
        </button>
        {error && <p className="mt-3 text-danger">⚠️ {error}</p>}
      </div>
    </main>
  );
}

function MentorPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [students, setStudents] = useState<StudentOut[]>([]);
  const [text, setText] = useState("XLM LONG\nПлечо 20х");
  const [audience, setAudience] = useState("all");
  const [deliveries, setDeliveries] = useState<DeliveryPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function loadStudents() {
    api.students(token).then(setStudents).catch((e) => setError(e.message));
  }
  useEffect(loadStudents, [token]);

  async function send() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.createSignal(token, text, audience);
      setDeliveries(res.deliveries);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-2xl font-extrabold">
          ⚡ <span className="text-accent-cyan">NMNH</span>{" "}
          <span className="text-accent-gold">ADMIN</span>
        </Link>
        <button
          className="btn-outline"
          onClick={() => {
            logoutMentor();
            onLogout();
          }}
        >
          Выйти
        </button>
      </header>

      {error && <p className="mt-4 text-danger">⚠️ {error}</p>}

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-xl font-semibold">Новый сигнал</h2>
          <textarea
            className="input h-32 w-full font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-2">
            <select className="input" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="all">Всем</option>
              <option value="moderate">Умеренным</option>
              <option value="turbo">Турбо</option>
            </select>
            <button className="btn-primary" onClick={send} disabled={loading}>
              {loading ? "Отправляем…" : "✅ Отправить"}
            </button>
          </div>

          {deliveries && (
            <div className="mt-4 text-sm">
              <p className="mb-2 text-text-secondary">Расчёт под аудиторию:</p>
              <ul className="space-y-1">
                {deliveries.map((d, i) => (
                  <li key={i} className="font-mono">
                    @{d.username || "—"} [{d.mode}] —{" "}
                    {d.status === "skipped" ? (
                      <span className="text-text-muted">пропуск</span>
                    ) : (
                      <span className="text-success">
                        маржа {d.margin_usd}$ / риск {d.risk_usd}$
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 text-xl font-semibold">Ученики ({students.length})</h2>
          {students.length === 0 ? (
            <p className="text-text-muted">Пока нет.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-text-muted">
                <tr>
                  <th className="py-1">Ник</th>
                  <th>Режим</th>
                  <th className="text-right">Баланс</th>
                  <th className="text-right">Статус</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-1">@{s.username || s.id}</td>
                    <td>{s.mode}</td>
                    <td className="text-right font-mono">
                      {s.balance_usdt ? Number(s.balance_usdt).toLocaleString("en-US") : "—"}$
                    </td>
                    <td className="text-right">
                      {s.is_approved && s.is_active ? "✅" : "⏸"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
