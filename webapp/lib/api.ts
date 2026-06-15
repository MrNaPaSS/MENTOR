// Клиент API NMNH Backend. Базовый URL — из NEXT_PUBLIC_API_URL.

import { logout, logoutMentor, getMentorToken, getAccessToken } from "./auth";

let baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

if (typeof window !== "undefined") {
  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    const currentHostname = window.location.hostname;
    if (currentHostname !== "localhost" && currentHostname !== "127.0.0.1") {
      baseUrl = `http://${currentHostname}:8000`;
    }
  }
}

export const API_URL = baseUrl;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    const authHeader = init?.headers && (init.headers as any)["Authorization"];
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      if (token === getMentorToken()) {
        logoutMentor();
        window.location.href = "/admin";
      } else if (token === getAccessToken()) {
        logout();
        window.location.href = "/";
      }
    }
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as any).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function authReq<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  return req<T>(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
  });
}

export interface PublicStats {
  total_signals: number;
  active_signals: number;
  active_students: number;
  winrate: string | null;
}

export interface LeaderboardRow {
  rank: number;
  username: string | null;
  mode: string;
  balance: string | null;
}

export interface TakeProfit {
  index: number;
  percent: string;
  price: string;
  profit_usd: string;
  rr: string;
}

export interface CalcResponse {
  mode: string;
  direction: string;
  balance: string;
  leverage: number;
  entry_price: string;
  margin_usd: string;
  position_size: string;
  sl_percent: string;
  sl_price: string;
  risk_usd: string;
  risk_percent_of_balance: string;
  margin_type: string;
  take_profits: TakeProfit[];
  warnings: string[];
  status: string;
}

export interface CalcRequest {
  mode: string;
  balance: string;
  entry_price: string;
  direction: string;
  leverage?: number | null;
}

export interface SignalOut {
  id: number;
  symbol: string;
  direction: string;
  leverage: number;
  entry_price: string;
  entry_type: string;
  stop_loss: string | null;
  tp1: string | null;
  tp2: string | null;
  tp3: string | null;
  margin_type: string;
  target_audience: string;
  status: string;
}

export interface Profile {
  id: number;
  username: string | null;
  weex_uid: string | null;
  mode: string;
  language: string;
  risk_percent: string | null;
  turbo_leverage: number | null;
  balance_usdt: string | null;
  balance_source: string;
}

export interface AnalyticsMe {
  signals_received: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface StudentOut {
  id: number;
  username: string | null;
  weex_uid: string | null;
  mode: string;
  language: string;
  balance_usdt: string | null;
  is_active: boolean;
  is_approved: boolean;
}

export interface DeliveryPreview {
  username: string | null;
  mode: string;
  balance: string | null;
  margin_usd: string | null;
  risk_usd: string | null;
  status: string;
}

export const api = {
  health: () => req<{ status: string }>("/api/health"),
  publicStats: () => req<PublicStats>("/api/stats/public"),
  leaderboard: () => req<LeaderboardRow[]>("/api/stats/leaderboard"),
  price: (symbol: string) =>
    req<{ symbol: string; price: string }>(`/api/market/price/${symbol}`),
  calculate: (body: CalcRequest) =>
    req<CalcResponse>("/api/market/calculate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  signals: () => req<SignalOut[]>("/api/signals"),
  activeSignals: () => req<SignalOut[]>("/api/signals/active"),
  signal: (id: number | string) => req<SignalOut>(`/api/signals/${id}`),

  // ── Auth ──
  requestCode: (weex_uid: string) =>
    req<{ ok: boolean; detail: string; code: string | null }>(
      "/api/auth/request-code",
      { method: "POST", body: JSON.stringify({ weex_uid }) }
    ),
  verify: (weex_uid: string, code: string) =>
    req<{ access_token: string; refresh_token: string }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ weex_uid, code }),
    }),
  mentorLogin: (password: string) =>
    req<{ access_token: string; refresh_token: string }>(
      `/api/auth/mentor-login?password=${encodeURIComponent(password)}`,
      { method: "POST" }
    ),
  devLogin: () =>
    req<{
      mentor: { access_token: string };
      student: { access_token: string; refresh_token: string };
      student_username: string;
    }>("/api/auth/dev-login", { method: "POST" }),

  // ── Авторизованные (ученик) ──
  profile: (token: string) => authReq<Profile>("/api/profile", token),
  patchProfile: (token: string, body: Partial<Profile>) =>
    authReq<Profile>("/api/profile", token, { method: "PATCH", body: JSON.stringify(body) }),
  refreshBalance: (token: string) => authReq<Profile>("/api/profile/balance", token),
  analyticsMe: (token: string) => authReq<AnalyticsMe>("/api/analytics/me", token),

  // ── Авторизованные (ментор) ──
  students: (token: string) => authReq<StudentOut[]>("/api/students", token),
  studentPatch: (token: string, id: number, body: Partial<StudentOut>) =>
    authReq<StudentOut>(`/api/students/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  studentApprove: (token: string, id: number) =>
    authReq<StudentOut>(`/api/students/${id}/approve`, token, { method: "POST" }),
  studentDelete: (token: string, id: number) =>
    authReq<{ ok: boolean }>(`/api/students/${id}`, token, { method: "DELETE" }),
  createSignal: (token: string, text: string, audience: string) =>
    authReq<{ signal: SignalOut; deliveries: DeliveryPreview[] }>("/api/signals", token, {
      method: "POST",
      body: JSON.stringify({ text, audience }),
    }),
  closeSignal: (token: string, id: number) =>
    authReq<SignalOut>(`/api/signals/${id}/close`, token, { method: "PATCH" }),

  // ── Партнёрская статистика WEEX (ментор) ──
  affiliateOverview: (token: string, days = 30) =>
    authReq<AffiliateOverview>(`/api/admin/affiliate/overview?days=${days}`, token),
  affiliateReferrals: (token: string, days = 30) =>
    authReq<ReferralRow[]>(`/api/admin/affiliate/referrals?days=${days}`, token),
  affiliateMentorBalance: (token: string) =>
    authReq<MentorBalance>(`/api/admin/affiliate/mentor-balance`, token),
};

export interface AffiliateOverview {
  referrals: number;
  total_deposit: string;
  total_spot_volume: string;
  total_futures_volume: string;
  total_commission: string;
  total_withdrawal: string;
  with_deposit: number;
  active_traders: number;
  period_days: number;
}

export interface ReferralRow {
  uid: string;
  register_time: number | null;
  kyc: boolean | null;
  deposit: string;
  balance: string;
  spot_volume: string;
  futures_volume: string;
  commission: string;
  withdrawal: string;
  has_traded: boolean;
  has_deposit: boolean;
}

export interface MentorBalance {
  available_balance: string;
  contract_total: string;
  spot_total: string;
  total_usdt: string;
}
