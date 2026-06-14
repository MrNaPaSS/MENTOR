"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, User, Crown, X } from "lucide-react";
import { api } from "@/lib/api";
import { setMentorToken, setStudentTokens } from "@/lib/auth";

/**
 * Кнопка разработчика: вход одним кликом как ментор (→ /admin) или ученик (→ /app).
 * Видна только в dev (NODE_ENV !== production), на localhost, или при NEXT_PUBLIC_DEV_LOGIN=1.
 * Бэкенд-эндпоинт /api/auth/dev-login сам отключён в проде.
 */
export default function DevBar() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"mentor" | "student" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isDev = process.env.NODE_ENV !== "production";
    const flagged = process.env.NEXT_PUBLIC_DEV_LOGIN === "1";
    const local =
      typeof window !== "undefined" &&
      /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    setShow(isDev || flagged || local);
  }, []);

  if (!show) return null;

  async function go(as: "mentor" | "student") {
    setBusy(as);
    setError(null);
    try {
      const res = await api.devLogin();
      if (as === "mentor") {
        setMentorToken(res.mentor.access_token);
        router.push("/admin");
      } else {
        setStudentTokens(res.student.access_token, res.student.refresh_token);
        router.push("/app/dashboard");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Dev-вход недоступен");
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
              <Wrench className="h-3.5 w-3.5" /> Dev-вход
            </span>
            <button onClick={() => setOpen(false)} className="text-text-muted hover:text-white" aria-label="Закрыть">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <button onClick={() => go("mentor")} disabled={!!busy} className="btn-gold w-full text-sm">
              <Crown className="h-4 w-4" /> {busy === "mentor" ? "Вход…" : "Как ментор → /admin"}
            </button>
            <button onClick={() => go("student")} disabled={!!busy} className="btn-primary w-full text-sm">
              <User className="h-4 w-4" /> {busy === "student" ? "Вход…" : "Как ученик → /app"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-danger">⚠️ {error}</p>}
          <p className="mt-2 text-[10px] text-text-muted">Только для разработки. В проде отключено.</p>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="glass flex h-11 w-11 items-center justify-center rounded-full text-accent-gold"
          aria-label="Dev-вход"
          title="Dev-вход"
        >
          <Wrench className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
