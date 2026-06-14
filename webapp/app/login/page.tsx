"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [uid, setUid] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.requestCode(uid.trim());
      setStep(2);
      // В dev-режиме бэкенд может вернуть код для удобства.
      if (res.code) setHint(`DEV: код ${res.code}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setLoading(true);
    setError(null);
    try {
      const tokens = await api.verify(uid.trim(), code.trim());
      localStorage.setItem("nmnh_access", tokens.access_token);
      localStorage.setItem("nmnh_refresh", tokens.refresh_token);
      router.push("/app/dashboard");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="card glow-cyan">
        <Link href="/" className="text-xl font-extrabold">
          ⚡ <span className="text-accent-cyan">NMNH</span>
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Вход в NMNH Platform</h1>

        {step === 1 ? (
          <div className="mt-6 space-y-3">
            <label className="block text-sm text-text-secondary">Ваш WEEX UID</label>
            <input
              className="input w-full"
              placeholder="123456789"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
            />
            <p className="text-xs text-text-muted">Найти UID: WEEX → Профиль → UID</p>
            <button className="btn-primary w-full" onClick={requestCode} disabled={loading || !uid}>
              {loading ? "Проверяем…" : "Получить код →"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-text-secondary">
              Код отправлен в Telegram бот @nmnh_bot
            </p>
            {hint && <p className="text-xs text-accent-gold">{hint}</p>}
            <input
              className="input w-full text-center font-mono text-2xl tracking-[0.5em]"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn-primary w-full" onClick={verify} disabled={loading || code.length < 6}>
              {loading ? "Проверяем код…" : "Войти"}
            </button>
            <button className="text-sm text-text-muted" onClick={() => setStep(1)}>
              ← Изменить UID
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-danger">⚠️ {error}</p>}
      </div>
    </main>
  );
}
