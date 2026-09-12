/**
 * Общая память панелей: возврат на «Рынок» показывает цифры сразу.
 *
 * Проверяем то, ради чего она заведена: уходим в другой раздел, возвращаемся -
 * и панель стоит с цифрами, а не собирается заново. Плюс то, что за одними и
 * теми же данными не ходят дважды.
 */

import { test, expect, Page, Route } from "@playwright/test";

const API = "http://localhost:8000";

const TICKERS = {
  source: "weex",
  stale: false,
  tickers: [
    { symbol: "BTCUSDT", price: "105000", priceChangePercent: "2.40", quoteVolume: "9000000000" },
    { symbol: "ETHUSDT", price: "4200", priceChangePercent: "-1.80", quoteVolume: "4200000000" },
  ],
};

const GLOBAL = {
  total_market_cap_usd: 2660000000000,
  total_volume_usd: 50780000000,
  btc_dominance: 58.2,
  market_cap_change_24h: -2.81,
  active_cryptos: 21145,
  source: "coingecko",
  stale: false,
};

async function setupMocks(page: Page, counters: Record<string, number>) {
  const json = (body: unknown, name?: string) => (route: Route) => {
    if (name) counters[name] = (counters[name] ?? 0) + 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  };

  await page.route(`${API}/api/**`, json({}));
  await page.route(`${API}/api/profile`, json({ id: 1, username: "e2e", language: "ru", mode: "moderate" }));
  await page.route(`${API}/api/coins`, json({ balance: 0, transactions: [], pending: [], pending_total: 0, pending_count: 0 }));
  await page.route(`${API}/api/coins/**`, json({ balance: 0, transactions: [], pending: [], pending_total: 0, pending_count: 0 }));
  await page.route(`${API}/api/certificates**`, json({ certificates: [], level: null }));
  await page.route(`${API}/api/certificates/**`, json({ certificates: [], level: null }));
  await page.route(`${API}/api/trades/**`, json({ trades: [], summary: null }));
  await page.route(`${API}/api/stats/**`, json({ total_signals: 0, active_signals: 0, active_students: 0, winrate: "0" }));
  await page.route(`${API}/api/scalping/**`, json({ rows: [] }));
  await page.route(`${API}/api/market/trending`, json({ coins: [] }));
  await page.route(`${API}/api/market/onchain`, json({ fees: { fastest: 0, half_hour: 0, hour: 0, economy: 0 }, hash_rate_ehs: 0, tx_count_24h: 0, market_price_usd: 0, difficulty_change_pct: 0, retarget_progress_pct: 0 }));
  await page.route(`${API}/api/market/fear-greed`, json({ current: null, history: [] }));
  await page.route(`${API}/api/market/funding-rates`, json({ rates: [] }));
  await page.route(`${API}/api/market/news**`, json({ lang: "ru", items: [] }));
  await page.route(`${API}/api/market/derivatives/**`, json({ symbol: "BTCUSDT", lastPrice: 0, priceChangePct: 0, fundingRate: null, nextFundingTime: null, openInterestUsd: null }));
  await page.route(`${API}/api/institutional/etf-flows`, json({ etfs: [], total_btc: 0, btc_price: 0 }));
  await page.route(`${API}/api/market/calendar`, json({ events: [], source: null, stale: false }));

  // За этими двумя и следим.
  await page.route(`${API}/api/market/global`, json(GLOBAL, "global"));
  await page.route(`${API}/api/market/tickers**`, json(TICKERS, "tickers"));
}

test.describe("Общая память панелей рынка", () => {
  test.setTimeout(120_000);

  test("возврат на «Рынок» не собирает панели заново", async ({ page }) => {
    const counters: Record<string, number> = {};
    await setupMocks(page, counters);
    await page.addInitScript(() => localStorage.setItem("nmnh_access", "test-token-e2e-123"));

    await page.goto("/app/market#maps");
    await expect(page.getByText("$2.66T")).toBeVisible({ timeout: 60_000 });
    const askedFirst = counters.global ?? 0;
    expect(askedFirst).toBeGreaterThan(0);

    // Уходим в другой раздел и возвращаемся - ссылками внутри приложения, как
    // ходит человек. Полная перезагрузка страницы память стирает, и это
    // правильно: она живёт во вкладке, а не в хранилище.
    await page.getByRole("link", { name: /Аналитика|Analytics/ }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole("link", { name: /Рынок|Market/ }).first().click();

    // Цифра на месте с первого кадра: её взяли из памяти, а не из сети.
    await expect(page.getByText("$2.66T")).toBeVisible({ timeout: 3_000 });
    // И за ней не ходили заново - значение ещё свежее.
    expect(counters.global).toBe(askedFirst);
  });

  test("две панели на одних тикерах спрашивают их один раз", async ({ page }) => {
    const counters: Record<string, number> = {};
    await setupMocks(page, counters);
    await page.addInitScript(() => localStorage.setItem("nmnh_access", "test-token-e2e-123"));

    await page.goto("/app/market#maps");
    await expect(page.getByText(/Тепловая карта рынка|Market heat map/)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_000);

    expect(counters.tickers).toBe(1);
  });
});
