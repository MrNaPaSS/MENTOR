"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { api, DeliveryPreview } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";
import { fmtUsd, modeLabel } from "@/lib/format";

const AUDIENCE = [
  { key: "all", label: "Всем" },
  { key: "moderate", label: "Умеренным" },
  { key: "turbo", label: "Турбо" },
] as const;

export default function NewSignal() {
  const token = useMentorToken();
  const [text, setText] = useState("XLM LONG\nПлечо 20х");
  const [audience, setAudience] = useState<(typeof AUDIENCE)[number]["key"]>("all");
  const [deliveries, setDeliveries] = useState<DeliveryPreview[] | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    setError(null);
    setDeliveries(null);
    try {
      const res = await api.createSignal(token, text, audience);
      setDeliveries(res.deliveries);
      setSymbol(res.signal.symbol);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-h2 text-white">Новый сигнал</h1>

      <div className="card space-y-4">
        <label className="block text-sm text-text-secondary">
          Текст сигнала (свободный формат)
          <textarea
            className="input mt-1.5 h-36 font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"XLM LONG\nПлечо 20х\nВход 0.150 (опц.)\nСтоп 0.145 (опц.)\nТП1 0.153 (опц.)"}
          />
        </label>

        <div>
          <span className="mb-2 block text-sm text-text-secondary">Аудитория</span>
          <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
            {AUDIENCE.map((a) => (
              <button
                key={a.key}
                onClick={() => setAudience(a.key)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  audience === a.key ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <button className="btn-primary w-full" onClick={send} disabled={loading}>
          {loading ? "Отправляем…" : <>Отправить сигнал <Send className="h-4 w-4" /></>}
        </button>

        {error && <p className="text-sm text-danger">⚠️ {error}</p>}
      </div>

      {deliveries && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold text-white">
            Расчёт под аудиторию{symbol ? ` · ${symbol}` : ""} ({deliveries.length})
          </h2>
          {deliveries.length === 0 ? (
            <p className="text-text-muted">Нет учеников в этой аудитории.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="py-2">Ученик</th>
                    <th>Режим</th>
                    <th className="text-right">Баланс</th>
                    <th className="text-right">Маржа</th>
                    <th className="text-right">Риск</th>
                    <th className="text-right">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-2 font-medium text-white">@{d.username || "—"}</td>
                      <td className="text-text-secondary">{modeLabel(d.mode)}</td>
                      <td className="text-right font-mono">{fmtUsd(d.balance)}$</td>
                      <td className="text-right font-mono">{d.margin_usd ? `${fmtUsd(d.margin_usd)}$` : "—"}</td>
                      <td className="text-right font-mono">{d.risk_usd ? `${fmtUsd(d.risk_usd)}$` : "—"}</td>
                      <td className="text-right">
                        <span className={`badge-${d.status === "skipped" ? "muted" : "success"}`}>
                          {d.status === "skipped" ? "пропуск" : "ожидает"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-text-muted">
            Сигнал создан и поставлен в очередь. Telegram-рассылку выполняет бот.
          </p>
        </div>
      )}
    </div>
  );
}
