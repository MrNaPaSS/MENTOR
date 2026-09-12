/**
 * Свои панели раздела «Рынок» вместо чужих виджетов (ТЗ этап 4).
 *
 * Проверяем то, что записано в критерии приёмки: на странице нет ни одного
 * тега script с внешнего домена, тепловая карта, календарь и потоки ETF
 * рисуются нашими компонентами, и карта показывает ненулевые проценты.
 *
 * Снимки снимаются в обеих темах - тёмной и светлой.
 */

import { test, expect, Page, Route } from "@playwright/test";

const API = "http://localhost:8000";

const TICKERS = {
  source: "weex",
  stale: false,
  tickers: [
    { symbol: "BTCUSDT", price: "105000", priceChangePercent: "2.40", quoteVolume: "9000000000" },
    { symbol: "ETHUSDT", price: "4200", priceChangePercent: "-1.80", quoteVolume: "4200000000" },
    { symbol: "SOLUSDT", price: "220", priceChangePercent: "4.90", quoteVolume: "1800000000" },
    { symbol: "XRPUSDT", price: "2.4", priceChangePercent: "0.30", quoteVolume: "900000000" },
    { symbol: "DOGEUSDT", price: "0.31", priceChangePercent: "-3.60", quoteVolume: "600000000" },
    { symbol: "TONUSDT", price: "5.2", priceChangePercent: "1.10", quoteVolume: "300000000" },
    { symbol: "LINKUSDT", price: "24", priceChangePercent: "-0.40", quoteVolume: "250000000" },
    { symbol: "AVAXUSDT", price: "38", priceChangePercent: "6.20", quoteVolume: "180000000" },
  ],
};

function iso(dayShift: number, hour: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dayShift);
  date.setUTCHours(hour, 30, 0, 0);
  return date.toISOString().replace(".000Z", "+00:00");
}

const CALENDAR = {
  source: "faireconomy",
  stale: false,
  events: [
    { time: iso(0, 12), currency: "USD", title: "Core CPI m/m", importance: "high", forecast: "0.3%", previous: "0.2%", actual: "0.4%" },
    { time: iso(0, 18), currency: "USD", title: "FOMC Statement", importance: "high", forecast: "4.25%", previous: "4.50%", actual: "" },
    { time: iso(1, 12), currency: "EUR", title: "ECB Main Refinancing Rate", importance: "medium", forecast: "2.15%", previous: "2.15%", actual: "" },
    { time: iso(2, 13), currency: "USD", title: "Unemployment Claims", importance: "medium", forecast: "221K", previous: "218K", actual: "" },
  ],
};

const ETF = {
  etfs: [
    { name: "BlackRock IBIT", ticker: "IBIT", btc: 340000, price: 61.2, change: 0.8, changePct: 1.3, sharePct: 48.5 },
    { name: "Fidelity FBTC", ticker: "FBTC", btc: 180000, price: 92.4, change: -0.6, changePct: -0.7, sharePct: 25.7 },
    { name: "ARK 21Shares ARKB", ticker: "ARKB", btc: 90000, price: 74.1, change: 0.2, changePct: 0.3, sharePct: 12.8 },
    { name: "Bitwise BITB", ticker: "BITB", btc: 55000, price: 58.3, change: -0.1, changePct: -0.2, sharePct: 7.8 },
  ],
  total_btc: 700000,
  btc_price: 105000,
};

async function setupMocks(page: Page) {
  const json = (body: unknown) => (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  // Порядок важен: Playwright перебирает маршруты с последнего, поэтому общая
  // заглушка идёт первой, а точные - после неё. Наоборот она съедала бы их, и
  // панели получали бы пустой объект там, где ждут список.
  await page.route(`${API}/api/**`, json({}));

  // Настоящий бэкенд на этой машине отвечает 401, а кабинет на 401 уводит на
  // посадочную страницу - до вкладок дело бы не дошло. Поэтому подменяем и
  // соседние ручки раздела, пустыми ответами нужной формы.
  await page.route(`${API}/api/profile`, json({ id: 1, username: "e2e", language: "ru", mode: "moderate" }));
  await page.route(`${API}/api/coins`, json({ balance: 0, transactions: [], pending: [], pending_total: 0, pending_count: 0 }));
  await page.route(`${API}/api/coins/**`, json({ balance: 0, transactions: [], pending: [], pending_total: 0, pending_count: 0 }));
  await page.route(`${API}/api/stats/**`, json({ total_signals: 0, active_signals: 0, active_students: 0, winrate: "0" }));
  await page.route(`${API}/api/trades/**`, json({ trades: [], summary: null }));
  await page.route(`${API}/api/certificates**`, json({ certificates: [], level: null }));
  await page.route(`${API}/api/certificates/**`, json({ certificates: [], level: null }));
  await page.route(`${API}/api/market/global`, json({ total_market_cap_usd: 0, total_volume_usd: 0, btc_dominance: 0, market_cap_change_24h: 0, active_cryptos: 0, source: "coingecko" }));
  await page.route(`${API}/api/market/trending`, json({ coins: [] }));
  await page.route(`${API}/api/market/onchain`, json({ fees: { fastest: 0, half_hour: 0, hour: 0, economy: 0 }, hash_rate_ehs: 0, tx_count_24h: 0, market_price_usd: 0, difficulty_change_pct: 0, retarget_progress_pct: 0 }));
  await page.route(`${API}/api/market/fear-greed`, json({ current: null, history: [] }));
  await page.route(`${API}/api/market/funding-rates`, json({ rates: [] }));
  await page.route(`${API}/api/market/news**`, json({ lang: "ru", items: [] }));
  await page.route(`${API}/api/market/derivatives/**`, json({ symbol: "BTCUSDT", lastPrice: 0, priceChangePct: 0, fundingRate: null, nextFundingTime: null, openInterestUsd: null }));
  await page.route(`${API}/api/scalping/**`, json({ rows: [] }));

  // Ради чего всё: три свои панели вместо трёх чужих виджетов.
  await page.route(`${API}/api/market/tickers**`, json(TICKERS));
  await page.route(`${API}/api/market/calendar`, json(CALENDAR));
  await page.route(`${API}/api/institutional/etf-flows`, json(ETF));
}

async function openMarket(page: Page, theme: "dark" | "light") {
  // Ошибку раздела видно только в браузере: печатаем её в вывод прогона,
  // иначе падение выглядит как «кнопки нет».
  page.on("pageerror", (err) => console.log(`ОШИБКА СТРАНИЦЫ: ${err.message}`));
  await setupMocks(page);
  // Токен и тему кладём до первого кадра: заход на посадочную страницу ради
  // хранилища тянул бы её собственные запросы и её же ошибки в этот тест.
  await page.addInitScript((value) => {
    localStorage.setItem("nmnh_access", "test-token-e2e-123");
    // Тема терминала живёт вне React - см. lib/terminalTheme.ts.
    localStorage.setItem("nmnh.scalping.theme", value as string);
  }, theme);
  await page.goto("/app/market#maps");
}

test.describe("Свои панели раздела «Рынок»", () => {
  // Первый заход поднимает dev-сервер и собирает страницу: тридцати секунд на
  // это не хватает, и падение выглядело бы как отсутствие вкладки.
  test.setTimeout(120_000);

  test("на странице нет внешних скриптов", async ({ page }) => {
    await openMarket(page, "dark");
    await page.waitForTimeout(1500);

    const external = await page.evaluate(() =>
      [...document.querySelectorAll("script[src]")]
        .map((s) => (s as HTMLScriptElement).src)
        .filter((src) => !src.startsWith(window.location.origin))
        // Скрипт мини-приложения Telegram грузит оболочка кабинета на всех
        // страницах - он не виджет рынка и к этому ТЗ отношения не имеет.
        .filter((src) => !src.includes("telegram.org")),
    );
    expect(external).toEqual([]);
  });

  for (const theme of ["dark", "light"] as const) {
    test(`карты и календарь рисуются своими компонентами: тема ${theme}`, async ({ page }) => {
      await openMarket(page, theme);

      // Вкладка «Карты»: тепловая карта и потоки ETF.
      const maps = page.getByRole("button", { name: /Карты|Maps/ });
      await maps.waitFor({ state: "visible", timeout: 60_000 });
      await maps.click();
      await expect(page.getByText(/Тепловая карта рынка|Market heat map/)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Биткоин-ETF|Bitcoin ETFs/)).toBeVisible();
      // Карта показывает ненулевые проценты - ради этого перестраивался /tickers.
      await expect(page.locator("text=+2.40%").first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("IBIT")).toBeVisible();
      await page.screenshot({ path: `e2e/shots/market-maps-${theme}.png`, fullPage: true });

      // Вкладка «Календарь»: свои строки вместо чужого виджета.
      const calendar = page.getByRole("button", { name: /Календарь|Calendar/ });
      await calendar.waitFor({ state: "visible", timeout: 60_000 });
      await calendar.click();
      await expect(page.getByText("Core CPI m/m")).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("FOMC Statement")).toBeVisible();
      await page.screenshot({ path: `e2e/shots/market-calendar-${theme}.png`, fullPage: true });
    });
  }
});
