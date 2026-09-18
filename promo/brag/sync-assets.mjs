/**
 * Собирает ассеты ролика из лендинга: картинки лежат в одном месте (webapp/public),
 * копии в репозитории не хранятся - они восстанавливаются этим скриптом.
 *
 * Запуск: node sync-assets.mjs
 */
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEBAPP = path.resolve(ROOT, "..", "..", "webapp");
const PUBLIC = path.join(WEBAPP, "public");
const MEDIA = path.join(WEBAPP, "out", "_next", "static", "media");

const IMAGES = {
  "shot-entry.webp": "showcase/case/01-entry-v2.webp",
  "shot-run.webp": "showcase/case/02-run-v2.webp",
  "shot-exit.webp": "showcase/case/03-exit-v2.webp",
  "card-eth.jpg": "showcase/case/04-card-nmnh.jpg",
  "card-xrp.jpg": "showcase/nmnh/01-xrpusdt.jpg",
  "card-jup.jpg": "showcase/nmnh/02-jupusdt.jpg",
  "card-tao.jpg": "showcase/nmnh/03-taousdt.jpg",
  "card-hype.jpg": "showcase/nmnh/06-hypeusdt.jpg",
  "analytics.webp": "art/landing/analytics.webp",
  "analytics-card.webp": "art/landing/analytics-card.webp",
  "analytics-adv.webp": "art/landing/analytics-advanced.webp",
  "logo.webp": "art/brand/logo.webp",
  "logo-mark.png": "nmnh_logo.png",
  "ex-weex.webp": "art/brand/weex-mark.webp",
  "ex-okx.webp": "art/brand/okx-mark.webp",
  "ex-bingx.webp": "art/brand/bingx-mark.webp",
  "ex-mexc.webp": "art/brand/mexc-mark.webp",
  "ex-binance.webp": "art/brand/binance-mark.webp",
};

/* Inter из сборки лендинга: шрифт ролика обязан совпадать со шрифтом сайта. */
const FONTS = {
  "inter-cyrillic.woff2": "ba9851c3c22cd980-s.woff2",
  "inter-latin.woff2": "e4af272ccee01ff0-s.p.woff2",
};

await mkdir(path.join(ROOT, "assets", "img"), { recursive: true });
await mkdir(path.join(ROOT, "assets", "font"), { recursive: true });

for (const [dst, src] of Object.entries(IMAGES)) {
  await copyFile(path.join(PUBLIC, src), path.join(ROOT, "assets", "img", dst));
}
for (const [dst, src] of Object.entries(FONTS)) {
  await copyFile(path.join(MEDIA, src), path.join(ROOT, "assets", "font", dst));
}

console.log(
  `Скопировано: ${Object.keys(IMAGES).length} изображений, ${Object.keys(FONTS).length} шрифта.`,
);
