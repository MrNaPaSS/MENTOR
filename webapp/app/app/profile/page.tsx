"use client";

import { useEffect, useState } from "react";
import { RefreshCw, LogOut } from "lucide-react";
import { api, Profile } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { fmtUsd, maskUid } from "@/lib/format";

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
    try {
      setP(await api.patchProfile(token, body));
    } catch {
      /* noop */
    } finally {
      setSaving(false);
    }
  }

  async function refreshBalance() {
    const token = getAccessToken();
    if (!token) return;
    setRefreshing(true);
    try {
      setP(await api.refreshBalance(token));
    } finally {
      setRefreshing(false);
    }
  }

  if (!p) return <div className="card"><div className="skeleton h-40 w-full" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-h2 text-white">Профиль</h1>

      {/* Основное */}
      <div className="card glass space-y-4">
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-accent-cyan/15 text-2xl font-bold text-accent-cyan ring-1 ring-accent-cyan/30">
            {(p.username || "U").slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div className="text-lg font-semibold text-white">@{p.username || "—"}</div>
            <div className="text-sm text-text-muted">WEEX UID: {maskUid(p.weex_uid)}</div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-bg-panel p-4">
          <div>
            <div className="text-xs text-text-muted">Баланс</div>
            <div className="font-mono text-2xl font-bold text-white tabular">
              {fmtUsd(p.balance_usdt)} <span className="text-sm text-text-muted">USDT</span>
            </div>
            <div className="text-[11px] text-text-muted">
              источник: {p.balance_source === "affiliate_api" ? "WEEX" : "вручную"}
            </div>
          </div>
          <button onClick={refreshBalance} className="btn-outline px-3" disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Настройки */}
      <div className="card space-y-5">
        <h2 className="text-lg font-semibold text-white">Настройки</h2>

        <Row label="Режим">
          <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
            {(["moderate", "turbo"] as const).map((m) => (
              <button
                key={m}
                onClick={() => patch({ mode: m })}
                disabled={saving}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  p.mode === m ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
                }`}
              >
                {m === "turbo" ? "⚡ Турбо" : "📊 Умеренный"}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Язык">
          <div className="flex gap-1 rounded-xl border border-border bg-bg-panel p-1">
            {(["ru", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => patch({ language: l })}
                disabled={saving}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase transition ${
                  p.language === l ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted hover:text-white"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </Row>

        {p.mode === "moderate" && (
          <Row label="Риск %">
            <input
              type="number"
              min={1}
              max={5}
              defaultValue={p.risk_percent ? Number(p.risk_percent) : 2}
              onBlur={(e) => patch({ risk_percent: e.target.value as unknown as string })}
              className="input w-24 font-mono"
            />
          </Row>
        )}
      </div>

      <button
        onClick={() => {
          logout();
          router.push("/");
        }}
        className="btn-danger w-full"
      >
        <LogOut className="h-4 w-4" /> Выйти из аккаунта
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
