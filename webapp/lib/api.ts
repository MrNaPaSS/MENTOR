// Клиент API NMNH Backend. Базовый URL — из NEXT_PUBLIC_API_URL.

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as any).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
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
};
