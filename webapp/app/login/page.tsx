"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import Logo from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { setStudentTokens } from "@/lib/auth";

const OTP_LEN = 6;

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [uid, setUid] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(""));
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resend, setResend] = useState(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join("");

  // Таймер повторной отправки
  useEffect(() => {
    if (resend <= 0) return;
    const t = setInterval(() => setResend((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [resend]);

  useEffect(() => {
    if (step === 2) inputs.current[0]?.focus();
  }, [step]);

  async function requestCode() {
    if (!uid.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Сначала пробуем прямой вход - если UID уже зарегистрирован, токены приходят сразу.
      const tokens = await api.loginByUid(uid.trim());
      setStudentTokens(tokens.access_token, tokens.refresh_token);
      setSuccess(true);
      setTimeout(() => window.location.href = "/app/dashboard", 700);
      return;
    } catch {
      // UID не зарегистрирован или другая ошибка - пробуем OTP-путь.
    }
    try {
      const res = await api.requestCode(uid.trim());
      setStep(2);
      setResend(60);
      if (res.code) setHint(`DEV: код ${res.code}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "UID не найден в системе");
    } finally {
      setLoading(false);
    }
  }

  async function verify(fullCode: string) {
    setLoading(true);
    setError(null);
    try {
      const tokens = await api.verify(uid.trim(), fullCode);
      setStudentTokens(tokens.access_token, tokens.refresh_token);
      setSuccess(true);
      setTimeout(() => window.location.href = "/app/dashboard", 700);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Неверный код");
      setLoading(false);
    }
  }

  function setDigit(i: number, val: string) {
    const clean = val.replace(/\D/g, "");
    if (!clean && val !== "") return;
    const next = [...digits];
    if (clean.length > 1) {
      // вставка/paste
      clean.split("").slice(0, OTP_LEN).forEach((c, k) => {
        if (i + k < OTP_LEN) next[i + k] = c;
      });
      setDigits(next);
      const last = Math.min(i + clean.length, OTP_LEN - 1);
      inputs.current[last]?.focus();
    } else {
      next[i] = clean;
      setDigits(next);
      if (clean && i < OTP_LEN - 1) inputs.current[i + 1]?.focus();
    }
    const joined = next.join("");
    if (joined.length === OTP_LEN && !joined.includes("")) verify(joined);
  }

  function onKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-radial-cyan" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:48px_48px] opacity-40 [mask-image:radial-gradient(60%_50%_at_50%_40%,black,transparent)]" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-border bg-bg-card/80 p-7 shadow-card backdrop-blur-xl">
          <h1 className="text-2xl font-bold text-white">Вход в NMNH Platform</h1>
          <p className="mt-1 text-sm text-text-muted">
            {step === 1 ? "Авторизация по WEEX UID" : "Подтверди вход кодом из Telegram"}
          </p>

          {step === 1 ? (
            <div className="mt-6 space-y-4">
              <label className="block text-sm text-text-secondary">
                Ваш WEEX UID
                <input
                  className="input mt-1.5 font-mono text-lg"
                  placeholder="123456789"
                  inputMode="numeric"
                  value={uid}
                  onChange={(e) => setUid(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && requestCode()}
                  autoFocus
                />
              </label>
              <p className="text-xs text-text-muted">
                Где взять UID: WEEX → Профиль → UID (числовой идентификатор аккаунта).
              </p>
              <p className="text-xs text-text-muted">
                Нет аккаунта WEEX?{" "}
                <a
                  href="https://www.weex.com/ru/register?vipCode=kaktotakxme"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan underline-offset-2 hover:underline"
                >
                  Зарегистрироваться →
                </a>
              </p>
              <button
                className="btn-primary w-full"
                onClick={requestCode}
                disabled={loading || !uid}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Получить код <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-5 animate-slide-down">
              <p className="text-sm text-text-secondary">
                Код отправлен в Telegram бот{" "}
                <span className="font-semibold text-accent-cyan">@nmnh_bot</span>
              </p>
              {hint && <p className="text-xs text-accent-gold">{hint}</p>}

              <div className="flex justify-between gap-2">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    value={d}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onKey(i, e)}
                    inputMode="numeric"
                    maxLength={6}
                    disabled={loading || success}
                    className={`h-14 w-full rounded-xl border bg-bg-panel text-center font-mono text-2xl text-white outline-none transition focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/25 ${
                      success ? "border-success" : error ? "border-danger" : "border-border"
                    }`}
                  />
                ))}
              </div>

              {success ? (
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-success">
                  <ShieldCheck className="h-5 w-5" /> Успешно! Перенаправляем…
                </div>
              ) : (
                <button
                  className="btn-primary w-full"
                  onClick={() => verify(code)}
                  disabled={loading || code.length < OTP_LEN}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Войти"}
                </button>
              )}

              <div className="flex items-center justify-between text-sm">
                <button
                  className="inline-flex items-center gap-1 text-text-muted transition hover:text-white"
                  onClick={() => {
                    setStep(1);
                    setDigits(Array(OTP_LEN).fill(""));
                    setError(null);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" /> Изменить UID
                </button>
                <button
                  className="text-accent-cyan disabled:text-text-muted"
                  onClick={requestCode}
                  disabled={resend > 0}
                >
                  {resend > 0 ? `Отправить повторно (${resend}с)` : "Отправить повторно"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
