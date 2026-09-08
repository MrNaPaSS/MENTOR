"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, ShieldCheck, AlertTriangle, Loader2, Send } from "lucide-react";
import Logo from "@/components/ui/Logo";
import LocaleSwitch from "@/components/ui/LocaleSwitch";
import { api } from "@/lib/api";
import { setStudentTokens } from "@/lib/auth";
import { SOCIAL_LINKS, weexRegisterUrl } from "@/lib/content";
import { useLocale, useT } from "@/lib/i18n";

const OTP_LEN = 6;

/** Длина одноразового пароля от бота академии, без черты. */
const PASS_LEN = 8;

/** Что в пароле значимо: буквы и цифры. Черта и регистр - оформление. */
function cleanPass(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PASS_LEN);
}

/** Показываем с чертой посередине: так его легче прочесть и набрать. */
function prettyPass(value: string): string {
  const clean = cleanPass(value);
  const half = PASS_LEN / 2;
  return clean.length > half ? `${clean.slice(0, half)}-${clean.slice(half)}` : clean;
}

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  // Telegram - основной путь: только через него UID биржи связывается с
  // человеком, а его ник попадает в подписи на карточках и снимках. Вход по
  // одному UID остаётся запасным и может быть закрыт на сервере.
  const [mode, setMode] = useState<"tg" | "uid">("tg");

  /**
   * Запасной вход по UID - только по прямому адресу `/login?uid=1`.
   *
   * Из интерфейса он убран: кабинет открывается через бота академии, и только
   * так UID биржи связывается с человеком. Но совсем убирать его из страницы
   * нельзя: если у кого-то не окажется tg_id ни на платформе, ни в боте,
   * вернуть ему доступ к собственному счёту надо уметь переменной на сервере,
   * а не пересборкой сайта. Ручки на сервере живут за тем же флагом.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("uid") === "1") {
      setMode("uid");
    }
  }, []);
  const [pass, setPass] = useState("");
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
      setTimeout(() => window.location.href = "/app/scalping", 700);
      return;
    } catch {
      // UID не зарегистрирован или другая ошибка - пробуем OTP-путь.
    }
    try {
      const res = await api.requestCode(uid.trim());
      setStep(2);
      setResend(60);
      if (res.code) setHint(`DEV: ${res.code}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.auth.uidNotFound);
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
      setTimeout(() => window.location.href = "/app/scalping", 700);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.auth.wrongCode);
      setLoading(false);
    }
  }

  /** Войти одноразовым паролем от бота академии. */
  async function enterByPass(value: string) {
    const clean = cleanPass(value);
    if (clean.length < PASS_LEN) return;
    setLoading(true);
    setError(null);
    try {
      const tokens = await api.loginByTgCode(clean);
      setStudentTokens(tokens.access_token, tokens.refresh_token);
      setSuccess(true);
      setTimeout(() => (window.location.href = "/app/scalping"), 700);
    } catch (e: unknown) {
      // Причину сервер не уточняет намеренно: «истёк» и «нет такого» -
      // подсказка тому, кто перебирает.
      setError(e instanceof Error ? e.message : t.auth.passFailed);
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
        <div className="mb-6 flex items-center justify-center gap-3">
          <Logo />
          <LocaleSwitch />
        </div>

        <div className="rounded-2xl border border-border bg-bg-card/80 p-7 shadow-card backdrop-blur-xl">
          <h1 className="text-2xl font-bold text-text-primary">{t.auth.title}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {mode === "tg"
              ? t.auth.subtitleTg
              : step === 1
                ? t.auth.subtitleUid
                : t.auth.subtitleCode}
          </p>

          {mode === "tg" ? (
            <div className="mt-6 space-y-4">
              <ol className="space-y-1.5 text-sm text-text-secondary">
                {t.auth.steps.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>

              <a
                href={SOCIAL_LINKS.academyBot}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:border-accent-cyan/40"
              >
                <Send className="h-4 w-4" /> {t.auth.openBot}
              </a>

              <label className="block text-sm text-text-secondary">
                {t.auth.passLabel}
                <input
                  className={`input mt-1.5 text-center font-mono text-2xl tracking-[0.2em] ${
                    success ? "border-success" : error ? "border-danger" : ""
                  }`}
                  placeholder="K7M4-QP2X"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  value={prettyPass(pass)}
                  disabled={loading || success}
                  onChange={(e) => {
                    const clean = cleanPass(e.target.value);
                    setPass(clean);
                    setError(null);
                    // Набрал целиком - входим сами: лишнее нажатие здесь ничего
                    // не решает, пароль либо подошёл, либо нет.
                    if (clean.length === PASS_LEN) void enterByPass(clean);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void enterByPass(pass)}
                  autoFocus
                />
              </label>
              <p className="text-xs text-text-muted">
                {t.auth.passHint}
              </p>

              {success ? (
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-success">
                  <ShieldCheck className="h-5 w-5" /> {t.auth.success}
                </div>
              ) : (
                <button
                  className="btn-primary w-full"
                  onClick={() => void enterByPass(pass)}
                  disabled={loading || cleanPass(pass).length < PASS_LEN}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t.auth.enter}
                </button>
              )}

            </div>
          ) : step === 1 ? (
            <div className="mt-6 space-y-4">
              <label className="block text-sm text-text-secondary">
                {t.auth.uidLabel}
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
                {t.auth.uidHint}
              </p>
              <button
                className="text-left text-xs text-accent-cyan transition hover:underline"
                onClick={() => {
                  setMode("tg");
                  setError(null);
                }}
              >
                {t.auth.uidBackToBot}
              </button>
              <p className="text-xs text-text-muted">
                {t.auth.uidFallbackNote}
              </p>
              <p className="text-xs text-text-muted">
                {t.auth.noAccount}{" "}
                <a
                  href={weexRegisterUrl(locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan underline-offset-2 hover:underline"
                >
                  {t.auth.registerLink}
                </a>
              </p>
              <button
                className="btn-primary w-full"
                onClick={requestCode}
                disabled={loading || !uid}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t.auth.requestCode} <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-5 animate-slide-down">
              <p className="text-sm text-text-secondary">
                {t.auth.codeSentTo}{" "}
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
                    className={`h-14 w-full rounded-xl border bg-bg-panel text-center font-mono text-2xl text-text-primary outline-none transition focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/25 ${
                      success ? "border-success" : error ? "border-danger" : "border-border"
                    }`}
                  />
                ))}
              </div>

              {success ? (
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-success">
                  <ShieldCheck className="h-5 w-5" /> {t.auth.success}
                </div>
              ) : (
                <button
                  className="btn-primary w-full"
                  onClick={() => verify(code)}
                  disabled={loading || code.length < OTP_LEN}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t.auth.enter}
                </button>
              )}

              <div className="flex items-center justify-between text-sm">
                <button
                  className="inline-flex items-center gap-1 text-text-muted transition hover:text-text-primary"
                  onClick={() => {
                    setStep(1);
                    setDigits(Array(OTP_LEN).fill(""));
                    setError(null);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" /> {t.auth.changeUid}
                </button>
                <button
                  className="text-accent-cyan disabled:text-text-muted"
                  onClick={requestCode}
                  disabled={resend > 0}
                >
                  {resend > 0 ? t.auth.resendIn(resend) : t.auth.resend}
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
