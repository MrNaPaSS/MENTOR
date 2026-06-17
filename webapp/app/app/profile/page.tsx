"use client";

import { useEffect, useState } from "react";
import { RefreshCw, LogOut, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { api, Profile } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtUsd, maskUid } from "@/lib/format";

const ADMIN_WEEX_UID = "6613031308";

const glass = {
  background: "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)",
  border: "1px solid rgba(255,255,255,0.08)",
};

export default function ProfilePage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.profile(token).then(setP).catch(() => {});
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
      <div
        className="relative overflow-hidden rounded-3xl p-6"
        style={{
          background: "linear-gradient(135deg, rgba(10,255,224,0.06) 0%, rgba(6,182,212,0.03) 50%, rgba(255,255,255,0.02) 100%)",
          border: "1px solid rgba(10,255,224,0.15)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Glow blob */}
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #0AFFE0, transparent 70%)" }}
        />

        {/* Avatar + info */}
        <div className="flex items-center gap-4">
          <div
            className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-2xl font-black"
            style={{
              background: "linear-gradient(135deg, rgba(10,255,224,0.15), rgba(6,182,212,0.08))",
              border: "1px solid rgba(10,255,224,0.3)",
              color: "#0AFFE0",
              boxShadow: "0 0 20px rgba(10,255,224,0.15)",
            }}
          >
            {initial}
            {isAdmin && (
              <span
                className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full"
                style={{ background: "#FFC400", boxShadow: "0 0 8px rgba(255,196,0,0.6)" }}
              >
                <ShieldCheck className="h-3 w-3 text-black" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">@{p.username || "—"}</div>
            <div className="mt-0.5 font-mono text-xs text-text-muted">WEEX UID: {maskUid(p.weex_uid)}</div>
          </div>
        </div>

        {/* Balance */}
        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="text-xs font-medium text-text-muted uppercase tracking-wider">Баланс</div>
            <div className="mt-1 font-mono text-3xl font-black tabular-nums text-white">
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
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all disabled:opacity-50"
            style={{ background: "rgba(10,255,224,0.08)", border: "1px solid rgba(10,255,224,0.2)", color: "#0AFFE0" }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* ── SETTINGS ── */}
      <div className="rounded-3xl p-6" style={glass}>
        <div className="mb-5 text-sm font-semibold uppercase tracking-widest text-text-muted">Настройки</div>

        <div className="space-y-5">

          {/* Mode */}
          <SettingRow label="Режим торговли">
            <div
              className="flex rounded-xl p-1"
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {(["moderate", "turbo"] as const).map((m) => {
                const active = p.mode === m;
                const color = m === "turbo" ? "#FF4757" : "#0AFFE0";
                const Icon = m === "turbo" ? Zap : TrendingUp;
                return (
                  <button
                    key={m}
                    onClick={() => patch({ mode: m })}
                    disabled={saving}
                    className="relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all duration-200 disabled:opacity-60"
                    style={{
                      color: active ? color : "rgba(255,255,255,0.35)",
                      background: active ? "rgba(255,255,255,0.07)" : "transparent",
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {m === "turbo" ? "Турбо" : "Умеренный"}
                    {active && (
                      <span
                        className="absolute inset-x-3 bottom-0 h-[2px] rounded-full"
                        style={{ background: color }}
                      />
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
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {(["ru", "en"] as const).map((l) => {
                const active = p.language === l;
                return (
                  <button
                    key={l}
                    onClick={() => patch({ language: l })}
                    disabled={saving}
                    className="relative flex-1 rounded-lg py-2 text-sm font-bold uppercase tracking-wider transition-all duration-200 disabled:opacity-60"
                    style={{
                      color: active ? "#0AFFE0" : "rgba(255,255,255,0.35)",
                      background: active ? "rgba(255,255,255,0.07)" : "transparent",
                    }}
                  >
                    {l}
                    {active && (
                      <span
                        className="absolute inset-x-3 bottom-0 h-[2px] rounded-full"
                        style={{ background: "#0AFFE0" }}
                      />
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
          className="flex items-center justify-between rounded-3xl px-6 py-4 transition-all duration-200 hover:opacity-90"
          style={{
            background: "linear-gradient(135deg, rgba(255,196,0,0.12), rgba(255,196,0,0.06))",
            border: "1px solid rgba(255,196,0,0.3)",
            boxShadow: "0 0 24px rgba(255,196,0,0.08)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 place-items-center rounded-xl"
              style={{ background: "rgba(255,196,0,0.15)", border: "1px solid rgba(255,196,0,0.3)" }}
            >
              <ShieldCheck className="h-4 w-4" style={{ color: "#FFC400" }} />
            </div>
            <span className="font-bold text-white">Админ панель</span>
          </div>
          <span style={{ color: "#FFC400" }}>→</span>
        </Link>
      )}

      {/* ── LOGOUT ── */}
      <button
        onClick={() => { logout(); router.push("/"); }}
        className="flex w-full items-center justify-center gap-2 rounded-3xl py-3.5 text-sm font-semibold transition-all duration-200 hover:opacity-90"
        style={{
          background: "rgba(255,71,87,0.08)",
          border: "1px solid rgba(255,71,87,0.2)",
          color: "#FF4757",
        }}
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
