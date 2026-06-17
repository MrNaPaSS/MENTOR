"use client";

export async function generateStaticParams() {
  return [];
}

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api, SignalOut } from "@/lib/api";
import { fmtUsd, isLong, modeLabel } from "@/lib/format";

export default function SignalDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [signal, setSignal] = useState<SignalOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    api.signal(params.id).then(setSignal).catch((e) => setError(e.message)).finally(() => setLoaded(true));
  }, [params?.id]);

  if (loaded && (error || !signal)) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="btn-ghost text-sm">
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="card text-center text-text-muted">Сигнал не найден.</div>
      </div>
    );
  }

  const long = signal ? isLong(signal.direction) : true;

  const levels = signal
    ? [
        { label: "Вход", value: signal.entry_price, tone: "text-white" },
        { label: "Стоп-лосс", value: signal.stop_loss, tone: "text-danger" },
        { label: "TP1", value: signal.tp1, tone: "text-success" },
        { label: "TP2", value: signal.tp2, tone: "text-success" },
        { label: "TP3", value: signal.tp3, tone: "text-success" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <button onClick={() => router.back()} className="btn-ghost text-sm">
        <ArrowLeft className="h-4 w-4" /> К ленте
      </button>

      {!loaded || !signal ? (
        <div className="card"><div className="skeleton h-40 w-full" /></div>
      ) : (
        <div className="card glass space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`badge-${long ? "success" : "danger"} text-sm`}>{signal.direction}</span>
              <h1 className="text-h3 text-white">{signal.symbol}</h1>
              <span className="text-text-muted">x{signal.leverage}</span>
            </div>
            <span className={`badge-${signal.status === "active" ? "cyan" : "muted"}`}>
              {signal.status === "active" ? "🟢 Активен" : "⚫ Закрыт"}
            </span>
          </div>

          <div className="text-sm text-text-muted">
            {modeLabel(signal.target_audience)} · вход {signal.entry_type === "market" ? "по рынку" : "лимит"} · маржа {signal.margin_type}
          </div>

          {/* Уровни */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {levels.map((l) => (
              <div key={l.label} className="rounded-xl border border-border bg-bg-panel p-3">
                <div className="text-xs text-text-muted">{l.label}</div>
                <div className={`mt-1 font-mono text-base font-semibold ${l.tone}`}>
                  {fmtUsd(l.value, 6)}$
                </div>
              </div>
            ))}
          </div>

          <a
            href={`https://www.weex.com/ru/futures/${signal.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full"
          >
            🚀 Войти в сделку <ExternalLink className="h-4 w-4" />
          </a>

          <p className="text-xs text-text-muted">
            Расчёт под твой баланс приходит в Telegram-боте. Это не финансовый совет - торговля сопряжена с риском.
          </p>
        </div>
      )}
    </div>
  );
}
