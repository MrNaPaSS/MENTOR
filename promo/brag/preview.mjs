/** Контрольные кадры: по одному снимку на сцену, чтобы проверить вёрстку до полного рендера. */
import { chromium } from "file:///E:/NMNH_TRADE/webapp/node_modules/playwright-core/index.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PAGE = process.env.PAGE || "vertical.html";
const W = Number(process.env.W || 1080);
const H = Number(process.env.H || 1920);
const OUT = path.join(ROOT, "preview", PAGE.replace(".html", ""));

const TIMES = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [1.8, 5.4, 9.6, 13.4, 17.2, 21.2];

const browser = await chromium.launch({
  args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(pathToFileURL(path.join(ROOT, PAGE)).href, { waitUntil: "load" });
await page.evaluate(() => window.ready);
await mkdir(OUT, { recursive: true });

for (const t of TIMES) {
  await page.evaluate((time) => window.seek(time), t);
  await page.screenshot({ path: path.join(OUT, `t_${t.toFixed(1)}.png`), animations: "disabled" });
}

await browser.close();
console.log(errors.length ? "ОШИБКИ:\n" + errors.join("\n") : `Кадры сняты: ${TIMES.join(", ")}`);
