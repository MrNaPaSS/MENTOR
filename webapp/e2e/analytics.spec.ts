/**
 * E2E tests for /app/analytics page.
 *
 * Mocks all backend API calls via page.route().
 * Auth token injected into localStorage as `nmnh_access`
 * (the key the app reads via getAccessToken() in lib/auth.ts).
 *
 * Test scenario: Rich student with 750K total volume.
 */

import { test, expect, Page, Route } from "@playwright/test";

// ─── Test Data ────────────────────────────────────────────────────────────────

const CALENDAR_DAYS = [
  // Positive PnL days
  { date: "2026-06-02", signals: 3, balance: 1050.0,  pnl_pct: 1.5,  trades: 12, trade_volume: 18500,  has_deposit: false },
  { date: "2026-06-03", signals: 2, balance: 1074.0,  pnl_pct: 2.3,  trades: 8,  trade_volume: 22000,  has_deposit: false },
  { date: "2026-06-04", signals: 5, balance: 1118.0,  pnl_pct: 4.1,  trades: 20, trade_volume: 35000,  has_deposit: true  },
  { date: "2026-06-05", signals: 1, balance: 1127.0,  pnl_pct: 0.8,  trades: 5,  trade_volume: 14000,  has_deposit: false },
  { date: "2026-06-09", signals: 4, balance: 1163.0,  pnl_pct: 3.2,  trades: 18, trade_volume: 28000,  has_deposit: false },
  // Negative PnL days
  { date: "2026-06-10", signals: 2, balance: 1149.0,  pnl_pct: -1.2, trades: 9,  trade_volume: 19500,  has_deposit: false },
  { date: "2026-06-11", signals: 1, balance: 1143.0,  pnl_pct: -0.5, trades: 6,  trade_volume: 12000,  has_deposit: false },
  { date: "2026-06-12", signals: 3, balance: 1111.0,  pnl_pct: -2.8, trades: 14, trade_volume: 21000,  has_deposit: false },
  // Deposit-only days (no PnL)
  { date: "2026-06-06", signals: 0, balance: null,    pnl_pct: null, trades: 0,  trade_volume: 0,      has_deposit: true  },
  { date: "2026-06-13", signals: 0, balance: null,    pnl_pct: null, trades: 0,  trade_volume: 0,      has_deposit: true  },
  // Active days (signals, no PnL snapshot)
  { date: "2026-06-16", signals: 2, balance: null,    pnl_pct: null, trades: 4,  trade_volume: 9000,   has_deposit: false },
  { date: "2026-06-17", signals: 3, balance: null,    pnl_pct: null, trades: 7,  trade_volume: 11000,  has_deposit: false },
  { date: "2026-06-18", signals: 2, balance: null,    pnl_pct: null, trades: 5,  trade_volume: 8500,   has_deposit: false },
  { date: "2026-06-19", signals: 4, balance: null,    pnl_pct: null, trades: 10, trade_volume: 16000,  has_deposit: false },
  { date: "2026-06-23", signals: 3, balance: null,    pnl_pct: null, trades: 8,  trade_volume: 13500,  has_deposit: false },
  { date: "2026-06-24", signals: 2, balance: null,    pnl_pct: null, trades: 6,  trade_volume: 10000,  has_deposit: false },
  { date: "2026-06-25", signals: 1, balance: null,    pnl_pct: null, trades: 3,  trade_volume: 7000,   has_deposit: false },
  { date: "2026-06-26", signals: 3, balance: null,    pnl_pct: null, trades: 9,  trade_volume: 15000,  has_deposit: false },
  { date: "2026-06-27", signals: 2, balance: null,    pnl_pct: null, trades: 7,  trade_volume: 12500,  has_deposit: false },
];

const MOCK_PROFILE = {
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

const MOCK_ANALYTICS_ME = {
  signals_received: 52,
  sent: 48,
  skipped: 4,
  failed: 0,
};

const MOCK_TRADE_SUMMARY = {
  futures_volume: 720000,
  spot_volume: 30000,
  total_volume: 750000,
  deposit_total: 3147,
  withdrawal_total: 0,
  commission: 2250,
};

const MOCK_DEPOSITS = [
  { type: "deposit", amount: 1500, coin: "USDT", timestamp: 1748995200000, date_iso: "2026-06-04", status: "done", txid: null },
  { type: "deposit", amount: 1000, coin: "USDT", timestamp: 1749081600000, date_iso: "2026-06-06", status: "done", txid: null },
  { type: "deposit", amount: 647,  coin: "USDT", timestamp: 1749340800000, date_iso: "2026-06-13", status: "done", txid: null },
];

const MOCK_TRADES_RESPONSE = {
  trades: [],
  stats: null,
  summary: MOCK_TRADE_SUMMARY,
  deposits: MOCK_DEPOSITS,
  withdrawals: [],
  transactions: [],
  needs_uid: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setupMocks(page: Page) {
  const API_BASE = "http://localhost:8000";

  await page.route(`${API_BASE}/api/profile`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_PROFILE) })
  );

  await page.route(`${API_BASE}/api/analytics/me`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_ANALYTICS_ME) })
  );

  await page.route(`${API_BASE}/api/analytics/calendar**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ days: CALENDAR_DAYS }) })
  );

  await page.route(`${API_BASE}/api/trades/me**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_TRADES_RESPONSE) })
  );

  await page.route(`${API_BASE}/api/market/**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ symbol: "BTCUSDT", price: "105000" }) })
  );

  await page.route(`${API_BASE}/api/health`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) })
  );

  await page.route(`${API_BASE}/api/stats/**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total_signals: 100, active_signals: 5, active_students: 20, winrate: "68" }) })
  );
}

async function openPage(page: Page) {
  await setupMocks(page);

  // Navigate to root first to establish origin, then inject token
  await page.goto("/");
  await page.evaluate(() => {
    // lib/auth.ts: const ACCESS = "nmnh_access"
    localStorage.setItem("nmnh_access", "test-token-e2e-123");
  });

  // Navigate to analytics page
  await page.goto("/app/analytics");

  // Wait for the page heading which confirms the analytics page rendered
  await expect(page.locator("h1")).toContainText("Аналитика", { timeout: 15000 });

  // Wait for calendar data to appear
  await page.waitForSelector("button[title]", { timeout: 10000 });
}

// ─── Calendar Tests ───────────────────────────────────────────────────────────

test.describe("Analytics Page - Calendar", () => {
  test("renders page heading", async ({ page }) => {
    await openPage(page);
    await expect(page.locator("h1")).toContainText("Аналитика");
    await expect(page.locator("h1")).toContainText("Прогресс");
  });

  test("renders weekday labels", async ({ page }) => {
    await openPage(page);
    for (const day of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
      await expect(page.getByText(day, { exact: true }).first()).toBeVisible();
    }
  });

  test("positive PnL day has green color style", async ({ page }) => {
    await openPage(page);

    // Day with pnl_pct: 1.5 shows "+1.5%" text
    const posCell = page.locator("button").filter({ hasText: "+1.5%" }).first();
    await expect(posCell).toBeVisible({ timeout: 10000 });

    const pnlSpan = posCell.locator("span").filter({ hasText: "+1.5%" });
    const color = await pnlSpan.evaluate((el) => window.getComputedStyle(el as HTMLElement).color);
    // #00D4A0 -> rgb(0, 212, 160)
    expect(color).toBe("rgb(0, 212, 160)");
  });

  test("negative PnL day has red color style", async ({ page }) => {
    await openPage(page);

    // Day with pnl_pct: -1.2 shows "1.2%" text (abs value)
    const negCell = page.locator("button").filter({ hasText: "1.2%" }).first();
    await expect(negCell).toBeVisible({ timeout: 10000 });

    const pnlSpan = negCell.locator("span").filter({ hasText: "1.2%" });
    const color = await pnlSpan.evaluate((el) => window.getComputedStyle(el as HTMLElement).color);
    // #FF4757 -> rgb(255, 71, 87)
    expect(color).toBe("rgb(255, 71, 87)");
  });

  test("deposit-only day shows +$ text indicator", async ({ page }) => {
    await openPage(page);

    // Days with has_deposit: true and no trade_volume show "+$" in cell center
    const depositIndicator = page.locator("button span").filter({ hasText: "+$" });
    await expect(depositIndicator.first()).toBeVisible({ timeout: 10000 });
  });

  test("deposit day has a green success dot in event indicators", async ({ page }) => {
    await openPage(page);

    // Green deposit dot: span.h-[5px].w-[5px].rounded-full.bg-success
    const depositDot = page.locator("button .bg-success").first();
    await expect(depositDot).toBeVisible({ timeout: 10000 });
  });

  test("clicking a positive PnL day opens detail popup", async ({ page }) => {
    await openPage(page);

    const dayButton = page.locator("button").filter({ hasText: "+1.5%" }).first();
    await dayButton.click();

    // Popup shows PnL value
    const popup = page.locator("div").filter({ hasText: "+1.50%" }).last();
    await expect(popup).toBeVisible({ timeout: 5000 });
  });

  test("clicking a day shows Russian month name in popup", async ({ page }) => {
    await openPage(page);

    const dayButton = page.locator("button").filter({ hasText: "+2.3%" }).first();
    await dayButton.click();

    // Date 2026-06-03 renders as "среда, 3 июня" in Russian
    await expect(page.getByText(/июня/)).toBeVisible({ timeout: 5000 });
  });

  test("clicking a deposit day shows Пополнение badge in popup", async ({ page }) => {
    await openPage(page);

    // Day 04 has pnl_pct: 4.1 AND has_deposit: true
    const dayButton = page.locator("button").filter({ hasText: "+4.1%" }).first();
    await dayButton.click();

    // The popup shows "+$ Пополнение" badge (exact span text)
    await expect(page.locator("span").filter({ hasText: "+$ Пополнение" })).toBeVisible({ timeout: 5000 });
  });

  test("prev month button exists and navigates back", async ({ page }) => {
    await openPage(page);

    const prevBtn = page.locator("button").filter({ hasText: "‹" });
    await expect(prevBtn).toBeVisible();
    await expect(prevBtn).toBeEnabled();
    await prevBtn.click();

    // After navigation, the calendar reloads
    await page.waitForTimeout(300);
    await expect(page.locator("h2").first()).toBeVisible();
  });

  test("next month button is disabled for current month", async ({ page }) => {
    await openPage(page);

    const nextBtn = page.locator("button").filter({ hasText: "›" });
    await expect(nextBtn).toBeVisible();
    // The next button is disabled when already at current month (June 2026)
    await expect(nextBtn).toBeDisabled();
  });

  test("profit and loss pills show correct day counts", async ({ page }) => {
    await openPage(page);

    // 5 positive days -> "5 в плюс"; 3 negative -> "3 в минус"
    await expect(page.locator("span").filter({ hasText: "5 в плюс" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("span").filter({ hasText: "3 в минус" })).toBeVisible();
  });

  test("month summary section shows итог месяца, лучший день, худший день", async ({ page }) => {
    await openPage(page);

    // Summary shows after >= 2 real days
    await expect(page.getByText("итог месяца")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("лучший день")).toBeVisible();
    await expect(page.getByText("худший день")).toBeVisible();
  });

  test("best day shows highest positive PnL", async ({ page }) => {
    await openPage(page);

    // Best day section: look for "лучший день" label and check the value above it
    // The structure is: <p class="font-mono text-base font-extrabold text-success">+4.1%</p>
    //                   <p class="text-[10px] text-white/30">лучший день</p>
    // in a grid col. Find the cell containing "лучший день" and check the sibling p above it.
    const bestDayLabel = page.locator("p").filter({ hasText: "лучший день" }).first();
    await expect(bestDayLabel).toBeVisible({ timeout: 10000 });

    // The value is the previous sibling p in the same div
    const bestDayValue = bestDayLabel.locator("..").locator("p.font-mono");
    await expect(bestDayValue).toContainText("+4.1%");
  });

  test("worst day shows most negative PnL", async ({ page }) => {
    await openPage(page);

    // Worst day is -2.8% (June 12)
    await expect(page.locator("p.font-mono.text-danger").first()).toContainText("-2.8%", { timeout: 10000 });
  });
});

// ─── KPI Tiles Tests ──────────────────────────────────────────────────────────

test.describe("Analytics Page - KPI Tiles", () => {
  test("renders all 4 KPI circle labels", async ({ page }) => {
    await openPage(page);

    await expect(page.getByText("Объём месяца")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Стрик активности").first()).toBeVisible();
    // "Ср. доходность/день" - exact text with slash
    await expect(page.locator("span").filter({ hasText: /^Ср\. доходность\/день$/ })).toBeVisible();
    await expect(page.getByText("Дней торговали").first()).toBeVisible();
  });

  test("volume KPI shows 250K goal label", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("цель: 250K")).toBeVisible({ timeout: 10000 });
  });

  test("streak KPI shows 7 day goal label", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("цель: 7 дней")).toBeVisible({ timeout: 10000 });
  });

  test("trading days KPI shows 15 day goal label", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("цель: 15 дней")).toBeVisible({ timeout: 10000 });
  });

  test("KPI circles render SVG progress rings", async ({ page }) => {
    await openPage(page);

    const svgRings = page.locator("svg circle[stroke-dasharray]");
    await expect(svgRings.first()).toBeVisible({ timeout: 10000 });
    const count = await svgRings.count();
    // 4 KPI circles + XP bar = at least 4
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

// ─── Volume Milestones Tests ──────────────────────────────────────────────────

test.describe("Analytics Page - Volume Milestones", () => {
  test("renders Путь трейдера section", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("Путь трейдера")).toBeVisible({ timeout: 10000 });
  });

  test("shows subtitle Суммарный объём на WEEX", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("Суммарный объём на WEEX")).toBeVisible({ timeout: 10000 });
  });

  test("shows all 7 milestone labels in the track", async ({ page }) => {
    await openPage(page);

    for (const label of ["50K", "100K", "500K", "1M", "5M", "10M", "25M"]) {
      // Milestone labels are font-mono text in the dots row
      const el = page.locator("div").filter({ has: page.locator(`span.font-mono:text-is("${label}")`) }).first();
      await expect(el).toBeVisible({ timeout: 10000 });
    }
  });

  test("reached milestones (50K, 100K, 500K) show checkmark badge", async ({ page }) => {
    await openPage(page);

    // Reached milestone circle shows "✓" in a small gold badge
    const checkmarks = page.locator("span.absolute").filter({ hasText: "✓" });
    await expect(checkmarks.first()).toBeVisible({ timeout: 10000 });
    const count = await checkmarks.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("shows progress percentage text toward next milestone", async ({ page }) => {
    await openPage(page);

    // Shows "X% до следующей вехи"
    await expect(page.getByText(/до следующей вехи/)).toBeVisible({ timeout: 10000 });
  });

  test("shows 'до 1M осталось' since volume is 750K between 500K and 1M", async ({ page }) => {
    await openPage(page);

    await expect(page.getByText(/до.*1M.*осталось/)).toBeVisible({ timeout: 10000 });
  });

  test("shows total volume header in gold", async ({ page }) => {
    await openPage(page);

    // Total 750,000 - formatted as "750.000" in de-DE locale
    const goldVolume = page.locator(".text-accent-gold").filter({ hasText: /750/ }).first();
    await expect(goldVolume).toBeVisible({ timeout: 10000 });
  });
});

// ─── XP / Level Tests ─────────────────────────────────────────────────────────

test.describe("Analytics Page - XP Level", () => {
  test("renders Уровень трейдера heading", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("Уровень трейдера")).toBeVisible({ timeout: 10000 });
  });

  test("shows level with Ур. prefix", async ({ page }) => {
    await openPage(page);

    const levelBadge = page.locator("span").filter({ hasText: /^Ур\. \d+$/ }).first();
    await expect(levelBadge).toBeVisible({ timeout: 10000 });
  });

  test("shows XP total as number with XP suffix", async ({ page }) => {
    await openPage(page);

    const xpTotal = page.locator("span.font-mono").filter({ hasText: /\d+ XP/ }).first();
    await expect(xpTotal).toBeVisible({ timeout: 10000 });
  });

  test("shows progress to next level text", async ({ page }) => {
    await openPage(page);

    const nextLevel = page.locator("p").filter({ hasText: /до ур\./ }).first();
    await expect(nextLevel).toBeVisible({ timeout: 10000 });
  });

  test("shows 6 XP source breakdown items", async ({ page }) => {
    await openPage(page);

    const xpSources = [
      /Объём:.*XP/,
      /Стрик:.*XP/,
      /Горячие дни:.*XP/,
      /Прибыль:.*XP/,
      /Дни:.*XP/,
      /Цели:.*XP/,
    ];

    for (const pattern of xpSources) {
      await expect(page.locator("span").filter({ hasText: pattern }).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("level title text is visible (Новичок or higher)", async ({ page }) => {
    await openPage(page);

    // XP breakdown: volXp = floor(750000/50000)*25 = 375
    //               streakXp would be from calendar data (trailing consecutive trade days)
    //               profitXp = 5 profit days * 15 = 75
    // At least "Новичок" or another level title should show
    const levelTitles = ["Новичок", "Начинающий", "Трейдер", "Уверенный", "Опытный", "Профи", "Эксперт"];
    let found = false;
    for (const title of levelTitles) {
      const count = await page.locator("p").filter({ hasText: title }).count();
      if (count > 0) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});

// ─── Monthly Goals Tests ──────────────────────────────────────────────────────

test.describe("Analytics Page - Monthly Goals", () => {
  test("renders Цели месяца section", async ({ page }) => {
    await openPage(page);
    // Use heading role to avoid matching "Выполни все цели месяца" achievement description
    await expect(page.getByRole("heading", { name: "Цели месяца" })).toBeVisible({ timeout: 10000 });
  });

  test("shows all 6 goal labels", async ({ page }) => {
    await openPage(page);

    const goalLabels = [
      "Объём за месяц",
      "Дней торговали",
      "Прибыльных дней",
      // "Стрик активности" appears in KPI and goal - use first()
      "Горячий день",
      "Месяц в плюс",
    ];
    for (const label of goalLabels) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 10000 });
    }
    // Streak appears in KPI and goals - just check it's present somewhere
    await expect(page.getByText("Стрик активности").first()).toBeVisible({ timeout: 10000 });
  });

  test("volume goal is unlocked (280K > 250K target)", async ({ page }) => {
    await openPage(page);

    // Unlocked goal shows reward text, not a ratio
    // "Объём за месяц" unlocked because monthVolume (sum of trade_volume) > 250K
    // Total trade_volume in CALENDAR_DAYS = 281000
    await expect(page.getByText("💹 Активный трейдер")).toBeVisible({ timeout: 10000 });
  });

  test("trading days goal is unlocked (18 days > 15 target)", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("📅 Дисциплина")).toBeVisible({ timeout: 10000 });
  });

  test("profit days goal is unlocked (6 days > 5 target)", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("📈 Бычий режим")).toBeVisible({ timeout: 10000 });
  });

  test("renders progress bars for all goals", async ({ page }) => {
    await openPage(page);

    // Progress bars: div.h-1.overflow-hidden.rounded-full inside goal cards
    const bars = page.locator("div.h-1.overflow-hidden.rounded-full");
    await expect(bars.first()).toBeVisible({ timeout: 10000 });
    const count = await bars.count();
    expect(count).toBeGreaterThanOrEqual(6);
  });

  test("unlocked goal shows CheckCircle2 icon with success color", async ({ page }) => {
    await openPage(page);

    // CheckCircle2 icons are rendered with text-success class
    const checkIcons = page.locator(".text-success");
    await expect(checkIcons.first()).toBeVisible({ timeout: 10000 });
  });

  test("Горячий день goal shows progress (2 hot days)", async ({ page }) => {
    await openPage(page);

    // Days with pnl_pct >= 3: June 09 (3.2%) and June 04 (4.1%) = 2 hot days
    // Target is 1, so it should be unlocked -> shows reward text
    await expect(page.getByText("🌟 День охотника")).toBeVisible({ timeout: 10000 });
  });
});

// ─── Achievements Tests ───────────────────────────────────────────────────────

test.describe("Analytics Page - Achievements", () => {
  test("renders Достижения section heading", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("Достижения")).toBeVisible({ timeout: 10000 });
  });

  test("shows X/36 count badge (36 total achievements = 8+8+8+6+6)", async ({ page }) => {
    await openPage(page);

    // 36 total: 8 volume + 8 discipline + 8 performance + 6 deposit + 6 special
    const badge = page.locator("span.font-mono").filter({ hasText: /\/\d+$/ }).first();
    await expect(badge).toBeVisible({ timeout: 10000 });
    const text = await badge.textContent();
    expect(text).toMatch(/\d+\/36/);
  });

  test("shows all 6 category tab buttons", async ({ page }) => {
    await openPage(page);

    for (const label of ["Все", "Объём", "Дисциплина", "Результаты", "Депозиты", "Особые"]) {
      await expect(page.getByText(label).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test("Все tab is active by default with gold border", async ({ page }) => {
    await openPage(page);

    // Active tab has specific class with accent-gold in border
    const activeTab = page.locator("button").filter({ hasText: /^Все\s*\d+\/\d+$/ }).first();
    await expect(activeTab).toBeVisible({ timeout: 10000 });

    // Check it has the active styling class
    const cls = await activeTab.getAttribute("class");
    expect(cls).toContain("text-accent-gold");
  });

  test("Все tab shows all 36 achievement cards", async ({ page }) => {
    await openPage(page);

    // 36 total achievements: 8 volume + 8 discipline + 8 performance + 6 deposit + 6 special
    const achievementGrid = page.locator(".grid.gap-3.sm\\:grid-cols-2");
    await expect(achievementGrid).toBeVisible({ timeout: 10000 });
    const cards = achievementGrid.locator("> div");
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBe(36);
  });

  // Helper: click a category tab by label (uses button role to avoid hitting goal labels)
  async function clickCategoryTab(page: Page, label: string) {
    // Category tabs are <button> elements inside the scrollable flex row above the achievement grid
    const tab = page.locator("button").filter({ hasText: new RegExp(`^${label}\\s*\\d+\\/\\d+$`) }).first();
    await tab.click();
    await page.waitForTimeout(400);
  }

  test("Объём category tab shows 8 volume achievements", async ({ page }) => {
    await openPage(page);
    await clickCategoryTab(page, "Объём");

    const achievementGrid = page.locator(".grid.gap-3.sm\\:grid-cols-2");
    const count = await achievementGrid.locator("> div").count();
    expect(count).toBe(8);
  });

  test("Дисциплина category tab shows 8 discipline achievements", async ({ page }) => {
    await openPage(page);
    await clickCategoryTab(page, "Дисциплина");

    const achievementGrid = page.locator(".grid.gap-3.sm\\:grid-cols-2");
    const count = await achievementGrid.locator("> div").count();
    expect(count).toBe(8);
  });

  test("Результаты category tab shows 8 performance achievements", async ({ page }) => {
    await openPage(page);
    await clickCategoryTab(page, "Результаты");

    const achievementGrid = page.locator(".grid.gap-3.sm\\:grid-cols-2");
    const count = await achievementGrid.locator("> div").count();
    expect(count).toBe(8);
  });

  test("Депозиты category tab shows 6 deposit achievements", async ({ page }) => {
    await openPage(page);
    await clickCategoryTab(page, "Депозиты");

    const achievementGrid = page.locator(".grid.gap-3.sm\\:grid-cols-2");
    const count = await achievementGrid.locator("> div").count();
    expect(count).toBe(6);
  });

  test("Особые category tab shows 6 special achievements", async ({ page }) => {
    await openPage(page);
    await clickCategoryTab(page, "Особые");

    const achievementGrid = page.locator(".grid.gap-3.sm\\:grid-cols-2");
    const count = await achievementGrid.locator("> div").count();
    expect(count).toBe(6);
  });

  test("earned achievement Добро пожаловать has no grayscale styling", async ({ page }) => {
    await openPage(page);

    // "Добро пожаловать" is always earned: earned: true
    const card = page.locator("div[class*='rounded-xl']").filter({ hasText: "Добро пожаловать" }).first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cls = await card.getAttribute("class");
    expect(cls).not.toContain("grayscale");
    expect(cls).not.toContain("opacity-50");
  });

  test("locked achievement Кит shows grayscale and opacity-50", async ({ page }) => {
    await openPage(page);

    // "Кит" requires 10K deposit total; we have 3147, so locked
    const card = page.locator("div[class*='rounded-xl']").filter({ hasText: "Кит" }).first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cls = await card.getAttribute("class");
    expect(cls).toContain("grayscale");
    expect(cls).toContain("opacity-50");
  });

  test("Старт (50K volume) achievement is earned with 750K total", async ({ page }) => {
    await openPage(page);

    const card = page.locator("div[class*='rounded-xl']").filter({ hasText: "Старт" }).first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cls = await card.getAttribute("class");
    expect(cls).not.toContain("grayscale");
  });

  test("Серьёзный (500K) achievement is earned with 750K total", async ({ page }) => {
    await openPage(page);

    const card = page.locator("div[class*='rounded-xl']").filter({ hasText: "Серьёзный" }).first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cls = await card.getAttribute("class");
    expect(cls).not.toContain("grayscale");
  });

  test("Миллионер (1M) achievement is NOT earned with 750K total", async ({ page }) => {
    await openPage(page);

    const card = page.locator("div[class*='rounded-xl']").filter({ hasText: "Миллионер" }).first();
    await expect(card).toBeVisible({ timeout: 10000 });

    const cls = await card.getAttribute("class");
    expect(cls).toContain("grayscale");
  });

  test("rarity badge Обычная is visible", async ({ page }) => {
    await openPage(page);
    await expect(page.locator("span").filter({ hasText: "Обычная" }).first()).toBeVisible({ timeout: 10000 });
  });

  test("rarity badge Редкая is visible", async ({ page }) => {
    await openPage(page);
    await expect(page.locator("span").filter({ hasText: "Редкая" }).first()).toBeVisible({ timeout: 10000 });
  });

  test("rarity badge Эпическая is visible", async ({ page }) => {
    await openPage(page);
    await expect(page.locator("span").filter({ hasText: "Эпическая" }).first()).toBeVisible({ timeout: 10000 });
  });

  test("rarity badge Легендарная is visible", async ({ page }) => {
    await openPage(page);
    await expect(page.locator("span").filter({ hasText: "Легендарная" }).first()).toBeVisible({ timeout: 10000 });
  });

  test("switching from Все to Объём reduces card count", async ({ page }) => {
    await openPage(page);

    const achievementGrid = page.locator(".grid.gap-3.sm\\:grid-cols-2");
    await expect(achievementGrid).toBeVisible({ timeout: 10000 });

    const allCount = await achievementGrid.locator("> div").count();
    expect(allCount).toBe(36); // 8 volume + 8 discipline + 8 performance + 6 deposit + 6 special = 36

    const allTab = page.locator("button").filter({ hasText: /^Все\s*\d+\/\d+$/ }).first();
    await allTab.click();
    await page.waitForTimeout(200);

    const volumeTab = page.locator("button").filter({ hasText: /^Объём\s*\d+\/\d+$/ }).first();
    await volumeTab.click();
    await page.waitForTimeout(400);

    const volumeCount = await achievementGrid.locator("> div").count();
    expect(volumeCount).toBe(8);
    expect(volumeCount).toBeLessThan(allCount);
  });

  test("achievement description text is visible", async ({ page }) => {
    await openPage(page);
    await expect(page.getByText("Суммарный объём 50 000 USDT")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Вступил в сообщество NMNH")).toBeVisible();
  });
});

// ─── Authentication Tests ──────────────────────────────────────────────────────

test.describe("Analytics Page - Authentication", () => {
  test("redirects to login when no auth token set", async ({ page }) => {
    // Suppress any network errors from missing backend
    await page.route("**/*", (route: Route) => {
      const url = route.request().url();
      if (url.includes("localhost:8000")) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Go directly to analytics without injecting auth token
    await page.goto("/app/analytics");

    // AppShell redirects to /login when no nmnh_access token
    await expect(page).toHaveURL(/\/(login|$)/, { timeout: 10000 });
  });

  test("stays on analytics page when auth token is present", async ({ page }) => {
    await openPage(page);
    await expect(page).toHaveURL(/\/app\/analytics/);
    await expect(page.locator("h1")).toContainText("Аналитика");
  });
});
