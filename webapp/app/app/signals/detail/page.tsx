"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api, SignalOut } from "@/lib/api";
import { fmtUsd, isLong, modeLabel } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n";
import { weexFuturesUrl } from "@/lib/content";

function SignalDetailContent() {
  const t = useT();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const [signal, setSignal] = useState<SignalOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.signal(id).then(setSignal).catch((e: Error) => setError(e.message)).finally(() => setLoaded(true));
  }, [id]);

  if (!id || (loaded && (error || !signal))) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="btn-ghost text-sm">
          <ArrowLeft className="h-4 w-4" /> {t.common.back}
        </button>
        <div className="card text-center text-text-muted">{t.signals.notFoundOne}</div>
      </div>
    );
  }

  const long = signal ? isLong(signal.direction) : true;

  const levels = signal
    ? [
        { label: t.signals.entry, value: signal.entry_price, tone: "text-text-primary" },
        { label: t.signals.stopLoss, value: signal.stop_loss, tone: "text-danger" },
        { label: "TP1", value: signal.tp1, tone: "text-success" },
        { label: "TP2", value: signal.tp2, tone: "text-success" },
        { label: "TP3", value: signal.tp3, tone: "text-success" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <button onClick={() => router.back()} className="btn-ghost text-sm">
        <ArrowLeft className="h-4 w-4" /> {t.signals.detailBackToFeed}
      </button>

      {!loaded || !signal ? (
        <div className="card"><div className="skeleton h-40 w-full" /></div>
      ) : (
        <div className="card glass space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`badge-${long ? "success" : "danger"} text-sm`}>{signal.direction}</span>
              <h1 className="text-h3 text-text-primary">{signal.symbol}</h1>
              <span className="text-text-muted">x{signal.leverage}</span>
            </div>
            <span className={`badge-${signal.status === "active" ? "cyan" : "muted"}`}>
              {signal.status === "active" ? t.signals.statusActive : t.signals.statusClosed}
            </span>
          </div>

          <div className="text-sm text-text-muted">
            {t.signals.detailLine(
              modeLabel(signal.target_audience, locale),
              signal.entry_type === "market" ? t.signals.entryMarket : t.signals.entryLimit,
              signal.margin_type
            )}
          </div>

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
            href={weexFuturesUrl(signal.symbol, locale)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full"
          >
            {t.signals.enterTrade} <ExternalLink className="h-4 w-4" />
          </a>

          <p className="text-xs text-text-muted">
            {t.signals.detailNote}
          </p>
        </div>
      )}
    </div>
  );
}

export default function SignalDetailPage() {
  return (
    <Suspense fallback={<div className="card"><div className="skeleton h-40 w-full" /></div>}>
      <SignalDetailContent />
    </Suspense>
  );
}
