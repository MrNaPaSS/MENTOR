"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, User, Crown, X } from "lucide-react";
import { api, type MarketStatus } from "@/lib/api";
import { setMentorToken, setStudentTokens } from "@/lib/auth";

/**
 * Кнопка разработчика: вход одним кликом как ментор (→ /admin) или ученик (→ /app).
 * Видна только в dev (NODE_ENV !== production), на localhost, или при NEXT_PUBLIC_DEV_LOGIN=1.
 * Бэкенд-эндпоинт /api/auth/dev-login сам отключён в проде.
 */
export default function DevBar() {
  const t = useT();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"mentor" | "student" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Здоровье источников рыночных данных: откуда сейчас приходят цены, кто
  // отказывает и много ли мы отдали устаревшего. Ручка открыта и лёгкая,
  // спрашиваем её только при открытой панели.
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);

  useEffect(() => {
    const isDev = process.env.NODE_ENV !== "production";
    const flagged = process.env.NEXT_PUBLIC_DEV_LOGIN === "1";
    const local =
      typeof window !== "undefined" &&
      /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    setShow(isDev || flagged || local);
  }, []);

  useEffect(() => {
    if (!open) return;
    let dropped = false;
    function load() {
      api
        .marketStatus()
        .then((r) => {
          if (dropped) return;
          setStatus(r);
          setStatusFailed(false);
        })
        .catch(() => {
          if (!dropped) setStatusFailed(true);
        });
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      dropped = true;
      clearInterval(timer);
    };
  }, [open]);

  if (!show) return null;

  async function go(as: "mentor" | "student") {
    setBusy(as);
    setError(null);
    try {
      const res = await api.devLogin();
      if (as === "mentor") {
        setMentorToken(res.mentor.access_token, res.mentor.refresh_token);
        window.location.href = "/admin";
      } else {
        setStudentTokens(res.student.access_token, res.student.refresh_token);
        window.location.href = "/app/scalping";
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.tools.dev.unavailable);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed bottom-4 left-4 z-[70]">
      {open ? (
        <div className="glass w-60 rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-accent-gold">
              <Wrench className="h-3.5 w-3.5" /> {t.tools.dev.title}
            </span>
            <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary" aria-label={t.common.close}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <button onClick={() => go("mentor")} disabled={!!busy} className="btn-gold w-full text-sm">
              <Crown className="h-4 w-4" /> {busy === "mentor" ? t.tools.dev.entering : t.tools.dev.asMentor}
            </button>
            <button onClick={() => go("student")} disabled={!!busy} className="btn-primary w-full text-sm">
              <User className="h-4 w-4" /> {busy === "student" ? t.tools.dev.entering : t.tools.dev.asStudent}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-danger">⚠️ {error}</p>}

          <div className="mt-3 border-t border-white/10 pt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
              {t.tools.dev.sources}
            </p>
            {statusFailed && <p className="text-[10px] text-danger">{t.tools.dev.sourcesFailed}</p>}
            {!statusFailed && status?.sources.length === 0 && (
              <p className="text-[10px] text-text-muted">{t.tools.dev.sourcesEmpty}</p>
            )}
            {status?.sources.map((s) => (
              <div key={s.name} className="flex items-baseline justify-between gap-2 text-[10px]">
                <span className="truncate text-text-secondary" title={s.last_error ?? undefined}>
                  {s.name}
                  {s.blocked_until && ` · ${t.tools.dev.blocked}`}
                </span>
                <span className="font-mono tabular-nums text-text-muted">
                  <span className="text-success">{s.ok}</span>
                  {" / "}
                  <span className={s.failed ? "text-danger" : ""}>{s.failed}</span>
                  {s.avg_latency_ms !== null && ` · ${Math.round(s.avg_latency_ms)}ms`}
                </span>
              </div>
            ))}
            {status && (
              <p className="mt-1 text-[10px] text-text-muted">
                {t.tools.dev.cache(status.cache.keys, status.cache.stale_served_last_hour)}
              </p>
            )}
          </div>

          <p className="mt-2 text-[10px] text-text-muted">{t.tools.dev.note}</p>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="glass flex h-11 w-11 items-center justify-center rounded-full text-accent-gold"
          aria-label={t.tools.dev.title}
          title={t.tools.dev.title}
        >
          <Wrench className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
