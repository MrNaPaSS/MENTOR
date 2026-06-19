/**
 * Shared test fixtures for analytics E2E tests.
 * Rich student scenario: 750K total volume, 280K month volume,
 * 18 trade days, 6 profit days, 8 activity streak, 3147 deposits.
 */

// Build current month calendar days (June 2026)
function buildCalendarDays() {
  const year = 2026;
  const month = 6; // June

  const days = [
    // Positive PnL days
    { date: `${year}-${String(month).padStart(2, "0")}-02`, signals: 3, balance: 1050.0,  pnl_pct: 1.5,  trades: 12, trade_volume: 18500,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-03`, signals: 2, balance: 1074.0,  pnl_pct: 2.3,  trades: 8,  trade_volume: 22000,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-04`, signals: 5, balance: 1118.0,  pnl_pct: 4.1,  trades: 20, trade_volume: 35000,  has_deposit: true  },
    { date: `${year}-${String(month).padStart(2, "0")}-05`, signals: 1, balance: 1127.0,  pnl_pct: 0.8,  trades: 5,  trade_volume: 14000,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-09`, signals: 4, balance: 1163.0,  pnl_pct: 3.2,  trades: 18, trade_volume: 28000,  has_deposit: false },
    // Negative PnL days
    { date: `${year}-${String(month).padStart(2, "0")}-10`, signals: 2, balance: 1149.0,  pnl_pct: -1.2, trades: 9,  trade_volume: 19500,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-11`, signals: 1, balance: 1143.0,  pnl_pct: -0.5, trades: 6,  trade_volume: 12000,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-12`, signals: 3, balance: 1111.0,  pnl_pct: -2.8, trades: 14, trade_volume: 21000,  has_deposit: false },
    // Deposit days (no PnL)
    { date: `${year}-${String(month).padStart(2, "0")}-06`, signals: 0, balance: null,     pnl_pct: null, trades: 0,  trade_volume: 0,      has_deposit: true  },
    { date: `${year}-${String(month).padStart(2, "0")}-13`, signals: 0, balance: null,     pnl_pct: null, trades: 0,  trade_volume: 0,      has_deposit: true  },
    // Active days (signals, no PnL snapshot)
    { date: `${year}-${String(month).padStart(2, "0")}-16`, signals: 2, balance: null,     pnl_pct: null, trades: 4,  trade_volume: 9000,   has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-17`, signals: 3, balance: null,     pnl_pct: null, trades: 7,  trade_volume: 11000,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-18`, signals: 2, balance: null,     pnl_pct: null, trades: 5,  trade_volume: 8500,   has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-19`, signals: 4, balance: null,     pnl_pct: null, trades: 10, trade_volume: 16000,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-23`, signals: 3, balance: null,     pnl_pct: null, trades: 8,  trade_volume: 13500,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-24`, signals: 2, balance: null,     pnl_pct: null, trades: 6,  trade_volume: 10000,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-25`, signals: 1, balance: null,     pnl_pct: null, trades: 3,  trade_volume: 7000,   has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-26`, signals: 3, balance: null,     pnl_pct: null, trades: 9,  trade_volume: 15000,  has_deposit: false },
    { date: `${year}-${String(month).padStart(2, "0")}-27`, signals: 2, balance: null,     pnl_pct: null, trades: 7,  trade_volume: 12500,  has_deposit: false },
  ];

  return days;
}

export const CALENDAR_DAYS = buildCalendarDays();

export const MOCK_ANALYTICS_ME = {
  signals_received: 52,
  sent: 48,
  skipped: 4,
  failed: 0,
};

export const MOCK_PROFILE = {
  id: 1,
  username: "test_student",
  weex_uid: "123456789",
  mode: "moderate",
  language: "ru",
  risk_percent: "1.5",
  turbo_leverage: null,
  balance_usdt: "1143.00",
  balance_source: "api",
};

export const MOCK_TRADE_SUMMARY = {
  futures_volume: 720000,
  spot_volume: 30000,
  total_volume: 750000,
  deposit_total: 3147,
  withdrawal_total: 0,
  commission: 2250,
};

export const MOCK_DEPOSITS = [
  { type: "deposit", amount: 1500, coin: "USDT", timestamp: 1748995200000, date_iso: "2026-06-04", status: "done", txid: null },
  { type: "deposit", amount: 1000, coin: "USDT", timestamp: 1749081600000, date_iso: "2026-06-06", status: "done", txid: null },
  { type: "deposit", amount: 647,  coin: "USDT", timestamp: 1749340800000, date_iso: "2026-06-13", status: "done", txid: null },
];

export const MOCK_TRADES_RESPONSE = {
  trades: [],
  stats: null,
  summary: MOCK_TRADE_SUMMARY,
  deposits: MOCK_DEPOSITS,
  withdrawals: [],
  transactions: [],
  needs_uid: false,
};
