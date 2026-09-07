"use client";

import { useEffect, useState } from "react";
import { Key, LogOut, RefreshCw, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { api, Profile } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtUsd, maskUid } from "@/lib/format";
import { tradingStatus, type TradingStatus } from "@/lib/trading";

const ADMIN_WEEX_UID = "6613031308";

// Карточки красятся палитрой темы: страница светлеет вместе с терминалом, а
// неоновая бирюза, вписанная числом, на белом листе слепит.
const CARD = "rounded-3xl border border-border bg-bg-card/60 p-6";

export default function ProfilePage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [exchange, setExchange] = useState<TradingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.profile(token).then(setP).catch(() => {});
    // Состояние биржевого счёта: ключи вводятся в терминале, а вопрос
    // «подключено ли» человек задаёт себе именно здесь.
    tradingStatus()
      .then(setExchange)
      .catch(() => {});
  }, []);

  async function patch(body: Partial<Profile>) {
    const token = getAccessToken();
    if (!token || !p) return;
    setSaving(true);
    try { setP(await api.patchProfile(token, body)); }
    catch { /* noop */ }
    finally { setSaving(false); }
  }

  async function refreshBalance() {
    const token = getAccessToken();
    if (!token) return;
    setRefreshing(true);
    try { setP(await api.refreshBalance(token)); }
    finally { setRefreshing(false); }
  }

  if (!p) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-48 w-full rounded-3xl" />
        <div className="skeleton h-40 w-full rounded-3xl" />
      </div>
    );
  }

  const initial = (p.username || "U").slice(0, 1).toUpperCase();
  const isAdmin = p.weex_uid === ADMIN_WEEX_UID;

  return (
    <div className="space-y-4">

      {/* ── USER CARD ── */}
      <div className="relative overflow-hidden rounded-3xl border border-accent-cyan/25 bg-gradient-to-br from-accent-cyan/[0.07] via-bg-card/60 to-bg-card/30 p-6 shadow-card">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent-cyan/20 blur-3xl" />

        {/* Avatar + info */}
        <div className="flex items-center gap-4">
          <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-accent-cyan/30 bg-accent-cyan/10 text-2xl font-black text-accent-cyan">
            {initial}
            {isAdmin && (
              <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-accent-gold">
                <ShieldCheck className="h-3 w-3 text-bg-deep" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-text-primary">@{p.username || "-"}</div>
            <div className="mt-0.5 font-mono text-xs text-text-muted">WEEX UID: {maskUid(p.weex_uid)}</div>
          </div>
        </div>

        {/* Balance */}
        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="text-xs font-medium text-text-muted uppercase tracking-wider">Баланс</div>
            <div className="mt-1 font-mono text-3xl font-black tabular-nums text-text-primary">
              {fmtUsd(p.balance_usdt)}
              <span className="ml-1.5 text-base font-semibold text-text-muted">USDT</span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {p.balance_source === "affiliate_api" ? "● Синхронизировано с WEEX" : "● Введено вручную"}
            </div>
          </div>
          <button
            onClick={refreshBalance}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-accent-cyan/25 bg-accent-cyan/10 px-3 py-2 text-xs font-semibold text-accent-cyan transition-all hover:bg-accent-cyan/15 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* ── Биржевой счёт ──
          Ключи вводятся в терминале, но вопрос «подключено ли» человек задаёт
          себе здесь - и ответа тут не было вовсе. */}
      <div className={CARD}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Биржевой счёт
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              exchange?.connected ? "bg-success/10 text-success" : "bg-bg-panel text-text-muted"
            }`}
          >
            {exchange?.connected ? "подключён" : "не подключён"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-bg-panel text-text-secondary">
            <Key className="h-4 w-4" />
          </div>
          <div className="min-w-0 text-sm">
            <div className="font-semibold text-text-primary">WEEX Futures</div>
            <div className="mt-0.5 text-[12px] text-text-muted">
              {exchange?.connected ? (
                <>
                  Ключ ···{exchange.key_tail}
                  {exchange.updated_at && (
                    <> · с {new Date(exchange.updated_at).toLocaleDateString("ru")}</>
                  )}
                </>
              ) : exchange && !exchange.enabled ? (
                "Хранилище ключей не настроено на сервере"
              ) : (
                "Без ключей торговля из терминала недоступна"
              )}
            </div>
          </div>
          <Link
            href="/app/scalping"
            className="ml-auto shrink-0 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent-cyan/40 hover:text-text-primary"
          >
            {exchange?.connected ? "Изменить" : "Подключить"}
          </Link>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
          Ключи хранятся зашифрованными и в браузер не возвращаются - только
          последние символы для опознания. Создавайте их с правом на торговлю и
          без права на вывод средств.
        </p>
      </div>

      {/* ── SETTINGS ── */}
      <div className={CARD}>
        <div className="mb-5 text-sm font-semibold uppercase tracking-widest text-text-muted">Настройки</div>

        <div className="space-y-5">

          {/* Mode */}
          <SettingRow label="Режим торговли">
            <div
              className="flex rounded-xl p-1"
              style={{ background: "rgb(var(--bg-deep) / 0.3)", border: "1px solid rgb(var(--border) / 0.7)" }}
            >
              {(["moderate", "turbo"] as const).map((m) => {
                const active = p.mode === m;
                const tone = m === "turbo" ? "text-danger" : "text-accent-cyan";
                const bar = m === "turbo" ? "bg-danger" : "bg-accent-cyan";
                const Icon = m === "turbo" ? Zap : TrendingUp;
                return (
                  <button
                    key={m}
                    onClick={() => patch({ mode: m })}
                    disabled={saving}
                    className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-60 ${
                      active ? `bg-bg-panel ${tone}` : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {m === "turbo" ? "Турбо" : "Умеренный"}
                    {active && (
                      <span className={`absolute inset-x-3 bottom-0 h-[2px] rounded-full ${bar}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </SettingRow>

          {/* Language */}
          <SettingRow label="Язык интерфейса">
            <div
              className="flex rounded-xl p-1"
              style={{ background: "rgb(var(--bg-deep) / 0.3)", border: "1px solid rgb(var(--border) / 0.7)" }}
            >
              {(["ru", "en"] as const).map((l) => {
                const active = p.language === l;
                return (
                  <button
                    key={l}
                    onClick={() => patch({ language: l })}
                    disabled={saving}
                    className={`relative flex-1 rounded-lg py-2 text-sm font-bold uppercase tracking-wider transition-all duration-200 disabled:opacity-60 ${
                      active ? "bg-bg-panel text-accent-cyan" : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {l}
                    {active && (
                      <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-accent-cyan" />
                    )}
                  </button>
                );
              })}
            </div>
          </SettingRow>

          {/* Risk % */}
          {p.mode === "moderate" && (
            <SettingRow label="Риск на сделку (%)">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={5}
                  defaultValue={p.risk_percent ? Number(p.risk_percent) : 2}
                  onBlur={(e) => patch({ risk_percent: e.target.value as unknown as string })}
                  className="input w-20 text-center font-mono font-bold"
                  style={{ fontSize: "1rem" }}
                />
                <span className="text-sm text-text-muted">от 1 до 5</span>
              </div>
            </SettingRow>
          )}
        </div>
      </div>

      {/* ── ADMIN ── */}
      {isAdmin && (
        <Link
          href="/admin"
          className="flex items-center justify-between rounded-3xl border border-accent-gold/30 bg-accent-gold/10 px-6 py-4 transition-all duration-200 hover:bg-accent-gold/15"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-accent-gold/30 bg-accent-gold/15">
              <ShieldCheck className="h-4 w-4 text-accent-gold" />
            </div>
            <span className="font-bold text-text-primary">Админ панель</span>
          </div>
          <span className="text-accent-gold">→</span>
        </Link>
      )}

      {/* ── LOGOUT ── */}
      <button
        onClick={() => { logout(); router.push("/"); }}
        className="flex w-full items-center justify-center gap-2 rounded-3xl border border-danger/25 bg-danger/10 py-3.5 text-sm font-semibold text-danger transition-all duration-200 hover:bg-danger/15"
      >
        <LogOut className="h-4 w-4" /> Выйти из аккаунта
      </button>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-sm text-text-secondary">{label}</span>
      <div className="w-48 shrink-0">{children}</div>
    </div>
  );
}
