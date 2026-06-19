// Клиент API NMNH Backend. Базовый URL - из NEXT_PUBLIC_API_URL.

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
    ...init,
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1", ...(init?.headers || {}) },
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
  chart_url?: string | null;
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

export interface CalendarDay {
  date: string;
  signals: number;
  balance: number | null;
  pnl_pct: number | null;
  estimated?: boolean;
  trades?: number;
  trade_volume?: number;
  has_deposit?: boolean;
}

export interface AnalyticsCalendar {
  days: CalendarDay[];
}

export interface Trade {
  timestamp: number;
  date_iso: string | null;
  symbol: string;
  product_type: string;
  side: string;
  volume: number;
  taker_amount: number;
  maker_amount: number;
  fee: number;
  commission: number;
  coin: string;
}

export interface TradeStats {
  total_trades: number;
  total_volume: number;
  total_fee: number;
  futures_count: number;
  spot_count: number;
  by_symbol: { symbol: string; trades: number; volume: number }[];
  by_day: { date: string; trades: number; volume: number }[];
}

export interface TradeSummary {
  futures_volume: number;
  spot_volume: number;
  total_volume: number;
  deposit_total: number;
  withdrawal_total: number;
  commission: number;
}

export interface DepositRecord {
  type?: "deposit" | "withdrawal";
  amount: number;
  coin: string;
  timestamp: number;
  date_iso: string | null;
  status?: string | null;
  txid?: string | null;
}

export interface TradesResponse {
  trades: Trade[];
  stats: TradeStats | null;
  summary: TradeSummary | null;
  deposits: DepositRecord[];
  withdrawals: DepositRecord[];
  transactions: DepositRecord[];
  needs_uid: boolean;
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
  loginByUid: (weex_uid: string) =>
    req<{ access_token: string; refresh_token: string }>("/api/auth/login-by-uid", {
      method: "POST",
      body: JSON.stringify({ weex_uid }),
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
  mentorLogin: (password: string) =>
    req<{ access_token: string; refresh_token: string }>(
      `/api/auth/mentor-login`,
      { method: "POST", body: JSON.stringify({ password }) }
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
  analyticsCalendar: (token: string, year: number, month: number) =>
    authReq<AnalyticsCalendar>(`/api/analytics/calendar?year=${year}&month=${month + 1}`, token),
  tradesMe: (token: string, days: number = 30) =>
    authReq<TradesResponse>(`/api/trades/me?days=${days}`, token),
  coins: (token: string) => authReq<CoinsBalance>("/api/coins", token),
  coinsSync: (token: string, body: CoinSyncIn) =>
    authReq<CoinSyncOut>("/api/coins/sync", token, { method: "POST", body: JSON.stringify(body) }),

  // ── Магазин (ученик) ──
  shopItems: (token: string) => authReq<ShopItem[]>("/api/shop/items", token),
  shopMyOrders: (token: string) => authReq<ShopOrder[]>("/api/shop/orders", token),
  shopBuy: (token: string, item_id: number, contact: string) =>
    authReq<ShopOrder>("/api/shop/orders", token, {
      method: "POST",
      body: JSON.stringify({ item_id, contact }),
    }),

  // ── Магазин (ментор) ──
  shopAdminItems: (token: string) => authReq<ShopItem[]>("/api/shop/admin/items", token),
  shopLinkPreview: (token: string, url: string) =>
    authReq<{ image: string | null }>(`/api/shop/admin/link-preview?url=${encodeURIComponent(url)}`, token),
  shopRefreshPreviews: (token: string) =>
    authReq<{ updated: number; total: number }>("/api/shop/admin/refresh-previews", token, { method: "POST" }),
  shopAdminCreate: (token: string, body: ShopItemInput) =>
    authReq<ShopItem>("/api/shop/admin/items", token, { method: "POST", body: JSON.stringify(body) }),
  shopAdminUpdate: (token: string, id: number, body: Partial<ShopItemInput>) =>
    authReq<ShopItem>(`/api/shop/admin/items/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  shopAdminDelete: (token: string, id: number) =>
    authReq<{ ok: boolean }>(`/api/shop/admin/items/${id}`, token, { method: "DELETE" }),
  shopAdminOrders: (token: string, status?: string) =>
    authReq<ShopOrder[]>(`/api/shop/admin/orders${status ? `?status=${status}` : ""}`, token),
  shopAdminFulfill: (token: string, id: number, mentor_note = "") =>
    authReq<ShopOrder>(`/api/shop/admin/orders/${id}/fulfill`, token, { method: "POST", body: JSON.stringify({ mentor_note }) }),
  shopAdminReject: (token: string, id: number, mentor_note = "") =>
    authReq<ShopOrder>(`/api/shop/admin/orders/${id}/reject`, token, { method: "POST", body: JSON.stringify({ mentor_note }) }),

  // ── Авторизованные (ментор) ──
  students: (token: string) => authReq<StudentOut[]>("/api/students", token),
  studentPatch: (token: string, id: number, body: Partial<StudentOut>) =>
    authReq<StudentOut>(`/api/students/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }),
  studentApprove: (token: string, id: number) =>
    authReq<StudentOut>(`/api/students/${id}/approve`, token, { method: "POST" }),
  studentDelete: (token: string, id: number) =>
    authReq<{ ok: boolean }>(`/api/students/${id}`, token, { method: "DELETE" }),
  createSignal: (token: string, text: string, audience: string, chart_url?: string) =>
    authReq<{ signal: SignalOut; deliveries: DeliveryPreview[] }>("/api/signals", token, {
      method: "POST",
      body: JSON.stringify({ text, audience, chart_url: chart_url || null }),
    }),
  broadcasts: (token: string) => authReq<BroadcastItem[]>("/api/broadcast", token),
  broadcast: (token: string, body: { text: string; chart_url?: string | null; audience: string }) =>
    authReq<{ sent: number; total: number }>("/api/broadcast", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createSignalDirect: (token: string, body: {
    symbol: string; direction: string; leverage: number;
    entry_price: number; stop_loss: number;
    tp1?: number; tp2?: number; tp3?: number;
    audience: string; chart_url?: string;
  }) =>
    authReq<{ signal: SignalOut; deliveries: DeliveryPreview[] }>("/api/signals/direct", token, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  closeSignal: (token: string, id: number) =>
    authReq<SignalOut>(`/api/signals/${id}/close`, token, { method: "PATCH" }),
  deleteSignal: (token: string, id: number) =>
    authReq<{ ok: boolean }>(`/api/signals/${id}`, token, { method: "DELETE" }),

  // ── Партнёрская статистика WEEX (ментор) ──
  affiliateOverview: (token: string, days = 30) =>
    authReq<AffiliateOverview>(`/api/admin/affiliate/overview?days=${days}`, token),
  affiliateReferrals: (token: string, days = 30) =>
    authReq<ReferralRow[]>(`/api/admin/affiliate/referrals?days=${days}`, token),
  affiliateCommissionSeries: (token: string, days = 14) =>
    authReq<CommissionPoint[]>(`/api/admin/affiliate/commission-series?days=${days}`, token),
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

export interface CommissionPoint {
  date: string;
  commission: string;
  spot: string;
  futures: string;
}

export interface BroadcastItem {
  id: number;
  text: string;
  chart_url: string | null;
  audience: string;
  sent_count: number;
  created_at: string;
}

export interface MentorBalance {
  available_balance: string;
  contract_total: string;
  spot_total: string;
  total_usdt: string;
}

export interface CoinTx {
  id: number;
  amount: number;
  reason: string;
  ref: string;
  created_at: string;
}

export interface CoinsBalance {
  balance: number;
  transactions: CoinTx[];
}

export interface CoinSyncIn {
  earned_achievement_ids: string[];
  current_level: number;
  reached_volume_milestones: string[];
}

export interface CoinSyncOut {
  balance: number;
  added: number;
  new_transactions: CoinTx[];
}

export interface ShopItem {
  id: number;
  title: string;
  description: string;
  price: number;
  category: string;
  section: string;   // "shop" | "software"
  icon: string;
  link_url: string;
  image_url: string;
  requires_tv: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ShopItemInput {
  title: string;
  description?: string;
  price: number;
  category?: string;
  section?: string;
  icon?: string;
  link_url?: string;
  image_url?: string;
  requires_tv?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export interface ShopOrder {
  id: number;
  item_id: number | null;
  item_title: string;
  price: number;
  status: string;    // "pending" | "fulfilled" | "rejected"
  contact: string;
  mentor_note: string;
  created_at: string;
  resolved_at: string | null;
  student_id?: number | null;
  student_username?: string | null;
  student_uid?: string | null;
}
