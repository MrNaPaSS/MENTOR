"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { api } from "@/lib/api";
import { useMentorToken } from "@/components/admin/AdminShell";

function tvImageUrl(url: string): string | null {
  const m = url.match(/tradingview\.com\/x\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const id = m[1];
  return `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
}

const AUDIENCE = [
  { key: "all",      label: "Всем" },
  { key: "moderate", label: "Умеренным" },
  { key: "turbo",    label: "Турбо" },
] as const;

export default function BroadcastPage() {
  const token = useMentorToken();
  const [text,      setText]      = useState("");
  const [chartUrl,  setChartUrl]  = useState("");
  const [symbol,    setSymbol]    = useState("");
  const [audience,  setAudience]  = useState<(typeof AUDIENCE)[number]["key"]>("all");
  const [result,    setResult]    = useState<{ sent: number; total: number } | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);

  async function send() {
    if (!text.trim() && !chartUrl.trim()) {
      setError("Введите текст или вставьте ссылку на чарт.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.broadcast(token, {
        text: text.trim(),
        chart_url: chartUrl.trim() || null,
        symbol: symbol.trim().toUpperCase() || null,
        audience,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка отправки");
    } finally {
      setLoading(false);
    }
  }

  const preview = chartUrl ? tvImageUrl(chartUrl) : null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-h2 text-white">Отправить анализ</h1>

      <div className="card space-y-5">

        {/* Текст */}
        <label className="block text-sm text-text-secondary">
          Текст / подпись
          <textarea
            className="input mt-1.5 h-24 resize-none"
            placeholder={"HYPE 4ч\nВижу движение вниз к зоне поддержки 8.5-9.0"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        {/* TradingView ссылка */}
        <label className="block text-sm text-text-secondary">
          График TradingView (необязательно)
          <input
            className="input mt-1.5 font-mono text-sm"
            placeholder="https://www.tradingview.com/x/eQTQ071J/"
            value={chartUrl}
            onChange={(e) => setChartUrl(e.target.value.trim())}
          />
        </label>

        {/* Торговая пара — для кнопки «Открыть график» у студентов */}
        <label className="block text-sm text-text-secondary">
          Пара для графика (необязательно)
          <input
            className="input mt-1.5 font-mono text-sm uppercase"
            placeholder="BTCUSDT"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
          <span className="mt-1 block text-[11px] text-text-muted">
            Если указать — на карточке анализа появится кнопка «Открыть график» с этой парой и стаканом.
          </span>
        </label>

        {/* Превью чарта */}
        {preview && (
          <a href={chartUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={preview}
              alt="chart preview"
              className="w-full rounded-xl border border-border object-cover max-h-64 hover:border-accent-cyan/30 transition-colors"
            />
          </a>
        )}

        {/* Аудитория */}
        <div>
          <p className="mb-1.5 text-sm text-text-secondary">Кому</p>
          <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
            {AUDIENCE.map((a) => (
              <button key={a.key} onClick={() => setAudience(a.key)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  audience === a.key ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
                }`}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn-primary w-full"
          onClick={send}
          disabled={loading || (!text.trim() && !chartUrl.trim())}
        >
          {loading ? "Отправляем…" : <><Send className="h-4 w-4" /> Отправить в Telegram</>}
        </button>

        {error && <p className="text-sm text-danger">⚠️ {error}</p>}

        {result && (
          <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            ✅ Отправлено {result.sent} из {result.total} студентов
          </div>
        )}
      </div>
    </div>
  );
}
